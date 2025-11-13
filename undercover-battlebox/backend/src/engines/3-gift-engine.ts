// src/engines/3-gift-engine.ts – v0.7.0
// PERFECTE GIFT ENGINE
//
// ✔ Nooit meer Onbekend (identity-engine verzorgt dat)
// ✔ Host gifts ALTIJD tellen wanneer game actief is
// ✔ Speler → speler buiten ronde = negeren
// ✔ Streak gifts correct (repeatEnd)
// ✔ Full logging
// ✔ Volledige host-detectie op 3 manieren
// ✔ DB-write altijd compleet

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────
// HOST CONFIG
// ─────────────────────────────────────────────

const HOST_RAW = (process.env.TIKTOK_USERNAME || "").replace("@", "").trim();
const HOST_NORM = normalize(HOST_RAW);

if (!HOST_NORM) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt of ongeldig!");
  process.exit(1);
}

// ─────────────────────────────────────────────
// ANTI-DUPLICATE
// ─────────────────────────────────────────────

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// ─────────────────────────────────────────────
// NORMALIZE HELPER
// ─────────────────────────────────────────────

function normalize(str?: string | null): string {
  return (str || "")
    .toLowerCase()
    .replace("@", "")
    .trim()
    .replace(/[^\p{L}\p{N}_]/gu, ""); // verwijder emoji en rommel
}

// ─────────────────────────────────────────────
// MAIN GIFT ENGINE
// ─────────────────────────────────────────────

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    try {
      const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
      const giftName = data.giftName || "Gift";

      if (msgId && processedMsgIds.has(msgId)) return;

      // 1) Extract sender
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        null
      )?.toString();

      if (!senderId) return;

      // 2) Diamonds + streak logic
      const diamondCount = Number(data.diamondCount || 0);
      if (diamondCount <= 0) return;

      const giftType = Number(data.giftType || 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount || 1);

      let creditedDiamonds = 0;

      if (giftType === 1) {
        if (!repeatEnd) return; // tussen-event
        creditedDiamonds = diamondCount * repeatCount;
      } else {
        creditedDiamonds = diamondCount;
      }

      if (creditedDiamonds <= 0) return;

      if (msgId) processedMsgIds.add(msgId);

      // 3) Sender ophalen
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsernameClean = sender.username.replace(/^@/, "");

      // 4) Receiver bepalen
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

      const nReceiverUnique = normalize(recUniqueIdRaw);
      const nReceiverNick = normalize(recNicknameRaw);

      const isToHost =
        nReceiverUnique === HOST_NORM ||
        nReceiverNick === HOST_NORM ||
        nReceiverNick.includes(HOST_NORM);

      let receiverId: string | null = null;
      let receiverDisplay = "";
      let receiverUsername = "";
      let receiverRole: "host" | "speler" = "host";

      if (isToHost) {
        receiverDisplay = recNicknameRaw || HOST_RAW;
        receiverUsername = HOST_RAW;
      } else {
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

      // 5) Ronde/game check
      const gameId = getCurrentGameId(); // null = geen game
      const arena = getArena();
      const now = Date.now();

      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;
      const isInRound = inActive || inGrace;

      // 6) Gift rules
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${giftName} → ${receiverDisplay}`,
        });
        return;
      }

      if (isToHost && !gameId) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Host gift, maar geen actief spel`,
        });
        return;
      }

      // 7) Scoring
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // Arena score (alleen speler in ronde)
      if (!isToHost && receiverId && isInRound) {
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // 8) DB Save
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
          giftName,
          creditedDiamonds,
          bpGain,
          gameId,
        ]
      );

      // 9) Log naar admin
      const receiverLabel = isToHost
        ? `${receiverDisplay} [HOST]`
        : `${receiverDisplay} (@${receiverUsername})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsernameClean}) → ${receiverLabel}: ${giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("❌ GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_RAW}`);
}
