// src/engines/3-gift-engine.ts
// STREAK-SAFE GIFT ENGINE + ARENA OP ONTVANGER + GAME STATS
// - Alleen 'gift' event
// - Streak gifts (giftType === 1) → alleen laatste event met repeatEnd === true
// - diamonds = diamondCount * repeatCount voor streaks
// - Schrijft naar giver_*/receiver_* + game_id in gifts
// - Arena-diamonds gaan naar ONTVANGER als het een speler is
// - emitLog → mooi leesbaar in Admin dashboard

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import {
  getArena,
  addDiamondsToArenaPlayer,
} from "./5-game-engine";
import {
  emitLog,
  getCurrentGameId,
  broadcastStats,
} from "../server";
import dotenv from "dotenv";

dotenv.config();

const HOST_USERNAME = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .toLowerCase()
  .trim();

if (!HOST_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// Eenvoudige dedup op msgId (voor veiligheid)
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    const giftName: string = data.giftName || "Onbekend";

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // === 1. SENDER (GIFTVERSTUURDER) ===
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const giftType = Number(data.giftType ?? 0); // 1 = streak
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount ?? 1);
      const rawDiamondCount = Number(data.diamondCount ?? 0);
      if (rawDiamondCount <= 0) return;

      // === 2. STREAK-LOGICA ===
      let creditedDiamonds = 0;

      if (giftType === 1) {
        // Streak gift
        if (!repeatEnd) {
          // tussen-events negeren
          return;
        }
        creditedDiamonds = rawDiamondCount * repeatCount;
      } else {
        // normale gift
        creditedDiamonds = rawDiamondCount;
      }

      if (creditedDiamonds <= 0) return;
      if (msgId) processedMsgIds.add(msgId);

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );
      const senderUsernameClean = sender.username.replace(/^@+/, "");

      // === 3. ONTVANGER (HOST of SPELER) ===
      const receiverUniqueIdRaw =
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        "";

      const receiverUniqueId = receiverUniqueIdRaw
        .toString()
        .replace("@", "")
        .toLowerCase()
        .trim();

      const receiverNicknameRaw: string =
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        "";

      const receiverNickname =
        receiverNicknameRaw || HOST_USERNAME.toUpperCase();

      // userId van de ontvanger (indien aanwezig)
      const receiverUserIdRaw =
        data.receiverUserId ||
        data.toUserId ||
        data.toUser?.userId ||
        data.receiver?.userId ||
        null;

      const isToHost =
        !receiverUserIdRaw ||
        receiverUniqueId === HOST_USERNAME ||
        receiverNickname.toLowerCase().includes(HOST_USERNAME);

      let receiverId: string | null = null;
      let receiverDisplayName: string;
      let receiverUsername: string;
      let receiverRole: "host" | "speler";

      if (isToHost) {
        // Gift naar host (twists etc.)
        receiverDisplayName = receiverNickname || HOST_USERNAME.toUpperCase();
        receiverUsername = HOST_USERNAME;
        receiverRole = "host";
      } else {
        const receiverUserId = String(receiverUserIdRaw);
        const receiver = await getOrUpdateUser(
          receiverUserId,
          receiverNickname,
          receiverUniqueId
        );
        receiverId = receiver.id;
        receiverDisplayName = receiver.display_name;
        receiverUsername = receiver.username.replace(/^@+/, "");
        receiverRole = "speler";
      }

      // === 4. PUNTEN VOOR DE GIFTVERSTUURDER (BP, diamonds als "gifter") ===
      // Deze diamonds worden nog steeds bij de SENDER geteld in users.diamonds_*,
      // maar de ARENA-score & game-stats gaan naar de ONTVANGER.
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // === 5. ARENA SCORE (OP BASIS VAN ONTVANGER) ===
      if (!isToHost && receiverId) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // === 6. DATABASE SAVE (GIFT LOG) ===
      const currentGameId = getCurrentGameId(); // kan null zijn als geen spel actief

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
          receiverDisplayName,
          receiverRole,
          giftName,
          creditedDiamonds,
          bpGain,
          currentGameId,
        ]
      );

      // === 7. LOG NAAR ADMIN DASHBOARD ===
      const receiverLabel = isToHost
        ? `${receiverDisplayName} (@${HOST_USERNAME}) [HOST]`
        : `${receiverDisplayName} (@${receiverUsername}) [SPELER]`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsernameClean}) → ${receiverLabel}: ${giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
        giver_display_name: sender.display_name,
        giver_username: senderUsernameClean,
        receiver_display_name: receiverDisplayName,
        receiver_username: receiverUsername,
        receiver_role: receiverRole,
        diamonds: creditedDiamonds,
        game_id: currentGameId,
      });

      // === 8. STATS & LEADERBOARD VERNIEUWEN ===
      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_USERNAME}`);
}
