// src/engines/3-gift-engine.ts — BATTLEBOX FINAL LIVE ENGINE — 12 NOV 2025
import dotenv from "dotenv";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import {
  getArena,
  addDiamondsToArenaPlayer,
} from "./5-game-engine";
import pool from "../db";
import { emitLog } from "../server";

dotenv.config();

// === HOST INSTELLINGEN ===
const HOST_USERNAME = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .toLowerCase()
  .trim();

if (!HOST_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// === GIFT DEDUPLICATIE ===
const seenGiftMsgIds = new Set<string>();

// === TWIST GIFTS (speciale invloed) ===
const TWIST_GIFTS = [
  "lion",
  "money gun",
  "whale",
  "corona",
  "jet",
  "gold mine",
];

// === BOOSTER GIFTS (kleine bonus) ===
const BOOSTER_GIFTS = ["rose", "heart", "hand heart", "tiktok", "unicorn"];

export function initGiftEngine(conn: any) {
  conn.on("liveRoomGift", async (data: any) => {
    try {
      // DEDUPLICATIE
      const msgId = data.msgId || data.giftId || data.id;
      if (!msgId) return;
      if (seenGiftMsgIds.has(msgId)) return;
      seenGiftMsgIds.add(msgId);
      setTimeout(() => seenGiftMsgIds.delete(msgId), 15000);

      // AFZENDER
      const senderId = (data.user?.userId || data.sender?.userId)?.toString();
      if (!senderId) return;

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const giftName = (data.giftName || "Onbekend").trim();
      const diamonds = data.diamondCount || 0;
      if (!diamonds) return;

      // ONTVANGER
      const receiverUniqueId =
        (data.toUser?.uniqueId ||
          data.receiver?.uniqueId ||
          data.receiverUniqueId ||
          "")
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

      // ONTVANGER USER (optioneel)
      let receiverName = HOST_USERNAME.toUpperCase();
      let receiverRole = "HOST";
      let receiverId = "0";

      if (!isToHost && receiverUniqueId) {
        const receiver = await getOrUpdateUser(
          data.receiverUserId || data.toUserId || senderId,
          data.toUser?.nickname || data.receiver?.nickname,
          data.toUser?.uniqueId || data.receiver?.uniqueId
        );
        receiverName = receiver.display_name;
        receiverId = receiver.tiktok_id;
        receiverRole = "COHOST";
      }

      // TWIST / BOOSTER HERKENNING
      const lowerGift = giftName.toLowerCase();
      const isTwist = TWIST_GIFTS.some((g) => lowerGift.includes(g));
      const isBooster = BOOSTER_GIFTS.some((g) => lowerGift.includes(g));

      // LOG NAAR CONSOLE
      console.log("\n🎁 GIFT DETECTED");
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} (${receiverRole})`);
      console.log(`   Gift: ${giftName} (${diamonds}💎)`);
      if (isTwist) console.log("   ⚡ TWIST GIFT GEDTECTEERD!");
      if (isBooster) console.log("   🔸 BOOSTER GIFT GEDTECTEERD!");
      console.log("=".repeat(80));

      // UPDATE POINTS & DIAMONDS
      await addDiamonds(BigInt(senderId), diamonds, "total");
      await addDiamonds(BigInt(senderId), diamonds, "stream");
      await addDiamonds(BigInt(senderId), diamonds, "current_round");

      const bpAmount = isBooster ? diamonds * 0.4 : diamonds * 0.2;
      await addBP(BigInt(senderId), bpAmount, "GIFT", sender.display_name);

      // ARENA UPDATE (alleen als niet host)
      if (!isToHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, diamonds);
        }
      }

      // SAVE IN DATABASE
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
          senderId,
          sender.username,
          sender.display_name,
          receiverId,
          receiverUniqueId || HOST_USERNAME,
          receiverName,
          receiverRole,
          giftName,
          diamonds,
          bpAmount,
        ]
      );

      // LOG NAAR DASHBOARD
      emitLog({
        type: isTwist ? "twist" : isBooster ? "booster" : "gift",
        message: `🎁 ${sender.display_name} → ${receiverName} | ${giftName} (${diamonds}💎, +${bpAmount.toFixed(
          1
        )} BP) [${receiverRole}]`,
      });
    } catch (err: any) {
      console.error("[GIFT ENGINE FOUT]", err.message);
    }
  });

  console.log(
    `[GIFT ENGINE] Actief → @${HOST_USERNAME} • Alleen liveRoomGift • Twist & Booster herkend`
  );
}
