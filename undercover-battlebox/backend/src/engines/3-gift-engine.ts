// src/engines/3-gift-engine.ts
// GIFT ENGINE – streak-safe, improved host-detection, always count host gifts
// Version: 0.6.1

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

// =========================================================
// HOST CONFIG — critical
// =========================================================

const RAW_HOST = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .trim();

const HOST_USERNAME = RAW_HOST.toLowerCase();

// =========================================================
// SAFETY: No host set = fatal error.
// =========================================================

if (!HOST_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// =========================================================
// MESSAGE DEDUP
// =========================================================

const processedMsgIds = new Set<string>();

setInterval(() => processedMsgIds.clear(), 60_000);

// =========================================================
// NORMALIZER — cleans usernames for reliable comparison
// =========================================================

function normalize(str: string | null | undefined): string {
  return (str || "")
    .toLowerCase()
    .replace("@", "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, ""); // strip emoji + symbols
}

// =========================================================
// INIT GIFT ENGINE
// =========================================================

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // ---------------------------------------------------------------------
      // 1. Extract sender
      // ---------------------------------------------------------------------
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();

      if (senderId === "0") return;

      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      // Streak handling
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

      processedMsgIds.add(msgId);

      // ---------------------------------------------------------------------
      // 2. SENDER USER
      // ---------------------------------------------------------------------

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsernameClean = sender.username.replace(/^@+/, "");

      // ---------------------------------------------------------------------
      // 3. RECEIVER ANALYSIS
      // ---------------------------------------------------------------------

      const recUniqueIdRaw =
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        "";

      const recNicknameRaw =
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        "";

      const recUserIdRaw =
        data.receiverUserId ||
        data.toUserId ||
        data.toUser?.userId ||
        data.receiver?.userId ||
        null;

      const nHost = normalize(HOST_USERNAME);
      const nUnique = normalize(recUniqueIdRaw);
      const nNick = normalize(recNicknameRaw);

      const isToHost =
        nUnique === nHost ||
        nNick === nHost ||
        nNick.includes(nHost);

      // DEBUG LOGGING AROUND HOST DETECT
      console.log("— HOST DEBUG —");
      console.log("Configured Host:", HOST_USERNAME);
      console.log("Normalized Host:", nHost);
      console.log("Gift receiver unique:", recUniqueIdRaw, "→", nUnique);
      console.log("Gift receiver nick:", recNicknameRaw, "→", nNick);
      console.log("isToHost =", isToHost);
      console.log("———————");

      let receiverId: string | null = null;
      let receiverDisplay = "";
      let receiverUsername = "";
      let receiverRole: "host" | "speler" = "host";

      if (isToHost) {
        receiverDisplay = recNicknameRaw || HOST_USERNAME;
        receiverUsername = HOST_USERNAME;
        receiverRole = "host";
      } else {
        // REAL PLAYER
        const receiverUser = await getOrUpdateUser(
          String(recUserIdRaw),
          recNicknameRaw,
          recUniqueIdRaw
        );
        receiverId = receiverUser.id;
        receiverDisplay = receiverUser.display_name;
        receiverUsername = receiverUser.username.replace(/^@/, "");
        receiverRole = "speler";
      }

      // ---------------------------------------------------------------------
      // 4. CHECK GAME STATE
      // ---------------------------------------------------------------------

      const gameId = getCurrentGameId(); // returns null if no active game
      const arena = getArena();
      const now = Date.now();

      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;
      const isInRound = inActive || inGrace;

      // ---------------------------------------------------------------------
      // 5. GIFT HANDLING RULES
      // ---------------------------------------------------------------------

      // A. Speler → speler buiten ronde = IGNORE
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${data.giftName} → ${receiverDisplay}`,
        });
        return;
      }

      // B. Host gifts → ONLY if game active
      if (isToHost) {
        if (!gameId) {
          emitLog({
            type: "system",
            message: `[GIFT IGNORE] Geen actief spel → host gift genegeerd`,
          });
          return;
        }

        emitLog({
          type: "system",
          message: `[HOST GIFT] ${sender.display_name} → ${receiverDisplay} (${creditedDiamonds}💎)`,
        });
      }

      // ---------------------------------------------------------------------
      // 6. UPDATE POINTS
      // ---------------------------------------------------------------------

      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(
        BigInt(senderId),
        bpGain,
        "GIFT",
        sender.display_name
      );

      // Arena diamonds only for players in round
      if (!isToHost && receiverId && isInRound) {
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // ---------------------------------------------------------------------
      // 7. SAVE TO DB
      // ---------------------------------------------------------------------

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

      // ---------------------------------------------------------------------
      // 8. LOG TO ADMIN
      // ---------------------------------------------------------------------

      const receiverLabel = isToHost
        ? `${receiverDisplay} (@${HOST_USERNAME}) [HOST]`
        : `${receiverDisplay} (@${receiverUsername}) [SPELER]`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsernameClean}) → ${receiverLabel}: ${data.giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
        giver_display_name: sender.display_name,
        giver_username: senderUsernameClean,
        receiver_display_name: receiverDisplay,
        receiver_username: receiverUsername,
        receiver_role: receiverRole,
        diamonds: creditedDiamonds,
        game_id: gameId,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_USERNAME}`);
}
