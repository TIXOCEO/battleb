// src/engines/3-gift-engine.ts — SIMPLE, STREAK-SAFE DEDUP (TIME-BASED) – 12 NOV 2025
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

// Bewaar heel kort recente gifts om echte dubbele events te negeren
// key = senderId:giftId:repeat:diamonds
const recentGiftEvents = new Map<string, number>();
// Hoe lang we een event als "mogelijk duplicaat" zien (ms)
const DEDUP_WINDOW_MS = 500;

export function initGiftEngine(conn: any) {
  const handleGiftEvent = async (data: any, source: string) => {
    const now = Date.now();

    const senderId = (
      data.user?.userId ||
      data.sender?.userId ||
      data.userId ||
      "0"
    ).toString();
    if (senderId === "0") return;

    const giftId = data.giftId || data.gift?.id || "unknown";
    const giftName = data.giftName || data.gift?.name || "Onbekend";
    const repeatCount = data.repeatCount || 1;
    const diamonds = data.diamondCount || 0;

    if (diamonds === 0) {
      // sommige test-events kunnen 0 zijn, die negeren we
      return;
    }

    // === Eenvoudige, streak-veilige dedup ===
    const key = `${senderId}:${giftId}:${repeatCount}:${diamonds}`;
    const lastSeen = recentGiftEvents.get(key);
    if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
      console.log(
        `⚠️  Duplicate gift binnen ${DEDUP_WINDOW_MS}ms genegeerd → ${giftName} (repeat ${repeatCount}, ${diamonds}💎)`
      );
      return;
    }
    recentGiftEvents.set(key, now);

    try {
      // === ONTVANGER BEREKENEN ===
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

      // === SENDER OPHALEN/MAKEN ===
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // === ONTVANGER DATA ===
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
        receiverId = Number(receiver.id || 0);
        receiverName = receiver.display_name;
        receiverUsername = receiver.username;
        receiverRole = "cohost";
      }

      // === LOGGING ===
      console.log(`\n🎁 GIFT (${source}) DETECTED`);
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(`   Aan: ${receiverName} (${receiverRole.toUpperCase()})`);
      console.log(
        `   Gift: ${giftName} (${diamonds}💎, repeat ${repeatCount})`
      );

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
  };

  // Beide eventtypes aan laten, maar dedup op fingerprint + tijd
  conn.on("gift", (data: any) => handleGiftEvent(data, "gift"));
  conn.on("liveRoomGift", (data: any) => handleGiftEvent(data, "liveRoomGift"));

  console.log(
    `[GIFT ENGINE] ACTIEF → Host: @${HOST_USERNAME} – time-based dedup (${DEDUP_WINDOW_MS}ms) + streak support`
  );
}
