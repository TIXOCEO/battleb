// src/engines/3-gift-engine.ts
// Undercover BattleBox — GIFT ENGINE v0.7.0
// - Ultra stabiele host-detectie
// - Streak-safe (giftType=1 → alleen repeatEnd)
// - Geen onbekenden bij gifts (user-engine + fallback)
// - Host gifts tellen ALTIJD (ook buiten rondes)
// - Player→player gifts buiten ronde worden genegeerd
// - Volledig compatibel met nieuwe server.ts

import pool from "../db";
import dotenv from "dotenv";

import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";

dotenv.config();

// ─────────────────────────────────────────
// HOST CONFIG
// ─────────────────────────────────────────

const HOST_RAW = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .trim()
  .toLowerCase();

if (!HOST_RAW) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// Normalize helper — critical for host detection
function normalize(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace("@", "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, ""); // remove emojis & symbols
}

// ─────────────────────────────────────────
// MESSAGE DEDUP (TikTok stuurt soms dubbel)
// ─────────────────────────────────────────

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// ─────────────────────────────────────────
// GIFT ENGINE
// ─────────────────────────────────────────

export function initGiftEngine(conn: any) {
  console.log(`[GIFT ENGINE] Actief — Host = @${HOST_RAW}`);

  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");

    // Prevent duplicates
    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // ───────────────────────────────────────
      // 1. SENDER
      // ───────────────────────────────────────
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();

      if (senderId === "0") return;

      // diamond count
      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      // streak logic
      const giftType = Number(data.giftType || 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount || 1);

      let creditedDiamonds = 0;

      if (giftType === 1) {
        if (!repeatEnd) return;
        creditedDiamonds = rawDiamonds * repeatCount;
      } else {
        creditedDiamonds = rawDiamonds;
      }

      if (creditedDiamonds <= 0) return;

      // mark processed
      if (msgId) processedMsgIds.add(msgId);

      // fetch sender info
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsernameClean = sender.username.replace(/^@/, "");

      // ───────────────────────────────────────
      // 2. RECEIVER (host / speler)
      // ───────────────────────────────────────

      const rawUnique = data.toUser?.uniqueId ||
                         data.receiver?.uniqueId ||
                         data.receiverUniqueId ||
                         "";

      const rawNick   = data.toUser?.nickname ||
                         data.receiver?.nickname ||
                         data.toUser?.displayName ||
                         "";

      const rawUserId =
        data.receiverUserId ||
        data.toUserId ||
        data.receiver?.userId ||
        data.toUser?.userId ||
        null;

      const nHost  = normalize(HOST_RAW);
      const nUniq  = normalize(rawUnique);
      const nNick  = normalize(rawNick);

      const isToHost =
        nUniq === nHost ||
        nNick === nHost ||
        nNick.includes(nHost);

      // Debug log zodat we zien wát TikTok precies stuurt
      console.log("──────── HOST DEBUG ────────");
      console.log("Host:", HOST_RAW, "→", nHost);
      console.log("Receiver Unique:", rawUnique, "→", nUniq);
      console.log("Receiver Nick:", rawNick, "→", nNick);
      console.log("isToHost:", isToHost);
      console.log("────────────────────────────");

      let receiverId: string | null = null;
      let receiverDisplay = "";
      let receiverUsername = "";
      let receiverRole: "host" | "speler" = "host";

      if (isToHost) {
        receiverDisplay = rawNick || HOST_RAW;
        receiverUsername = HOST_RAW;
        receiverRole = "host";
      } else {
        const receiver = await getOrUpdateUser(
          String(rawUserId),
          rawNick,
          rawUnique
        );
        receiverId = receiver.id;
        receiverDisplay = receiver.display_name;
        receiverUsername = receiver.username.replace(/^@/, "");
        receiverRole = "speler";
      }

      // ───────────────────────────────────────
      // 3. GAME STATE
      // ───────────────────────────────────────
      const gameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();

      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;
      const isInRound = inActive || inGrace;

      // ───────────────────────────────────────
      // 4. RULES
      // ───────────────────────────────────────

      // ✖ Speler → speler buiten ronde = IGNORE
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${data.giftName} → ${receiverDisplay}`,
        });
        return;
      }

      // ✔ Host gifts ALTIJD tellen wanneer game actief is
      if (isToHost) {
        if (!gameId) {
          emitLog({
            type: "system",
            message: `[GIFT IGNORE] Geen actief spel → gift naar host genegeerd`,
          });
          return;
        }

        emitLog({
          type: "system",
          message: `[HOST GIFT] ${sender.display_name} → ${receiverDisplay} (${creditedDiamonds}💎)`,
        });
      }

      // ───────────────────────────────────────
      // 5. UPDATE POINTS (BP + diamonds)
      // ───────────────────────────────────────
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // Arena update (alleen speler binnen ronde)
      if (!isToHost && isInRound && receiverId) {
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // ───────────────────────────────────────
      // 6. SAVE TO DB
      // ───────────────────────────────────────
      await pool.query(
        `
        INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name, receiver_role,
          gift_name, diamonds, bp, game_id, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      `,
        [
          BigInt(senderId),
          senderUsernameClean,
          sender.display_name,

          receiverId ? BigInt(receiverId) : null,
          receiverUsername,
          receiverDisplay,
          receiverRole,

          data.giftName || "Onbekend",
          creditedDiamonds,
          bpGain,
          gameId,
        ]
      );

      // ───────────────────────────────────────
      // 7. LOGS + STATS + BROADCAST
      // ───────────────────────────────────────

      const label = isToHost
        ? `${receiverDisplay} [HOST]`
        : `${receiverDisplay} (@${receiverUsername})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsernameClean}) → ${label}: ${data.giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
        giver_username: senderUsernameClean,
        receiver_username: receiverUsername,
        receiver_role: receiverRole,
        diamonds: creditedDiamonds,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });
}
