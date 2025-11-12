// src/engines/3-gift-engine.ts
// GIFT ENGINE – verbeterde host-detectie + altijd tellen bij actief spel

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
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

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// Helper om emoji en spaties te verwijderen voor robuuste vergelijking
function normalizeName(str: string | null | undefined): string {
  return (str || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_@]/gu, ""); // verwijder emoji en symbolen
}

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    const giftName: string = data.giftName || "Onbekend";

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const giftType = Number(data.giftType ?? 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount ?? 1);
      const rawDiamondCount = Number(data.diamondCount ?? 0);
      if (!rawDiamondCount || rawDiamondCount <= 0) return;

      let creditedDiamonds = 0;
      if (giftType === 1) {
        if (!repeatEnd) return;
        creditedDiamonds = rawDiamondCount * repeatCount;
      } else {
        creditedDiamonds = rawDiamondCount;
      }
      if (creditedDiamonds <= 0) return;
      if (msgId) processedMsgIds.add(msgId);

      // SENDER
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );
      const senderUsernameClean = sender.username.replace(/^@+/, "");

      // RECEIVER
      const receiverUniqueId = normalizeName(
        data.toUser?.uniqueId ||
          data.receiver?.uniqueId ||
          data.receiverUniqueId
      );
      const receiverNickname = normalizeName(
        data.toUser?.nickname ||
          data.receiver?.nickname ||
          data.toUser?.displayName
      );
      const receiverUserIdRaw =
        data.receiverUserId ||
        data.toUserId ||
        data.toUser?.userId ||
        data.receiver?.userId ||
        null;

      // === Verbeterde host-detectie ===
      const hostNorm = normalizeName(HOST_USERNAME);
      const isToHost =
        normalizeName(receiverUniqueId) === hostNorm ||
        normalizeName(receiverNickname).includes(hostNorm) ||
        normalizeName(data.toUser?.uniqueId) === hostNorm ||
        normalizeName(data.toUser?.nickname) === hostNorm;

      let receiverId: string | null = null;
      let receiverDisplayName: string;
      let receiverUsername: string;
      let receiverRole: "host" | "speler";

      if (isToHost) {
        receiverDisplayName =
          data.toUser?.nickname ||
          data.receiver?.nickname ||
          HOST_USERNAME.toUpperCase();
        receiverUsername = HOST_USERNAME;
        receiverRole = "host";
      } else {
        const receiverUserId = String(receiverUserIdRaw);
        const receiver = await getOrUpdateUser(
          receiverUserId,
          data.toUser?.nickname || data.receiver?.nickname,
          data.toUser?.uniqueId || data.receiver?.uniqueId
        );
        receiverId = receiver.id;
        receiverDisplayName = receiver.display_name;
        receiverUsername = receiver.username.replace(/^@+/, "");
        receiverRole = "speler";
      }

      // Check game en ronde status
      const currentGameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();
      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;
      const isInRound = inActive || inGrace;

      // === LOGICA ===
      // Speler → speler buiten ronde: negeren
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${giftName} → ${receiverDisplayName}`,
        });
        return;
      }

      // Gifts naar host → altijd tellen als er een spel actief is
      if (isToHost && currentGameId) {
        emitLog({
          type: "system",
          message: `[GIFT HOST] ${sender.display_name} → ${receiverDisplayName} (${giftName}, ${creditedDiamonds}💎)`,
        });
      }

      // === Punten bijwerken ===
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // Arena-score (alleen bij spelers)
      if (!isToHost && receiverId && isInRound) {
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // === DB save ===
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

      // === Log zichtbaar in admin ===
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

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_USERNAME}`);
}
