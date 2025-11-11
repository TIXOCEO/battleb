// src/engines/3-gift-engine.ts — CLEAN & FIXED HOSTNAME HANDLING (11 NOV 2025)
import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
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

const seenGiftMsgIds = new Set<string>();

export function initGiftEngine(conn: any) {
  conn.on("liveRoomGift", async (data: any) => {
    const msgId = data.msgId || data.giftId || data.id;
    if (!msgId) return;
    if (seenGiftMsgIds.has(msgId)) return;
    seenGiftMsgIds.add(msgId);
    setTimeout(() => seenGiftMsgIds.delete(msgId), 15000);

    try {
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const diamonds = data.diamondCount || 0;
      if (diamonds === 0) return;

      const giftName = data.giftName || "Onbekend";

      const receiverUniqueId = (
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        ""
      )
        .toString()
        .replace("@", "")
        .toLowerCase()
        .trim();

      const receiverDisplay =
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        "HOST";

      const isToHost =
        receiverUniqueId === HOST_USERNAME ||
        receiverUniqueId.includes(HOST_USERNAME) ||
        receiverDisplay.toLowerCase().includes(HOST_USERNAME);

      // === SENDER ===
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // === ONTVANGER ===
      let receiverName = HOST_USERNAME.toUpperCase();
      let receiverRole = "host";
      let receiverId = 0;
      let receiverUsername = HOST_USERNAME;

      if (!isToHost && receiverUniqueId) {
        const receiver = await getOrUpdateUser(
          data.receiverUserId || data.toUserId || senderId,
          data.toUser?.nickname || data.receiver?.nickname,
          data.toUser?.uniqueId || data.receiver?.uniqueId
        );
        receiverId = Number(receiver.id);
        receiverName = receiver.display_name;
        receiverUsername = receiver.username;
        receiverRole = "cohost";
      }

      // === LOGGING ===
      console.log(`\n🎁 GIFT DETECTED`);
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} (${receiverRole.toUpperCase()})`);
      console.log(`   Gift: ${giftName} (${diamonds}💎)`);

      // === POINTS ===
      await addDiamonds(BigInt(senderId), diamonds, "total");
      await addDiamonds(BigInt(senderId), diamonds, "stream");
      await addDiamonds(BigInt(senderId), diamonds, "current_round");
      await addBP(BigInt(senderId), diamonds * 0.2, "GIFT", sender.display_name);

      // === ARENA BONUS ===
      if (!isToHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, diamonds);
          console.log(`   +${diamonds}💎 toegevoegd aan ARENA`);
        }
      } else {
        console.log(`   ⚡ TWIST GIFT → géén arena update`);
      }

      // === DATABASE SAVE ===
      await pool.query(
        `
        INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name, receiver_role,
          gift_name, diamonds, bp, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        `,
        [
          BigInt(senderId),
          sender.username,
          sender.display_name,
          receiverId,
          receiverUsername,
          receiverName,
          receiverRole,
          giftName,
          diamonds,
          diamonds * 0.2,
        ]
      );

      console.log("💾 Gift opgeslagen in database");
      console.log("=".repeat(80));
    } catch (err: any) {
      console.error("❌  GiftEngine error:", err.message);
    }
  });

  console.log(
    `[GIFT ENGINE] ACTIEF → Host: @${HOST_USERNAME} (uit .env) – Alleen liveRoomGift wordt verwerkt`
  );
}
