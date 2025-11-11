// src/engines/3-gift-engine.ts — STREAK-SAFE GIFT ENGINE (11/12 NOV 2025)
// - Alleen 'gift' event
// - Streak gifts (giftType === 1) → alleen laatste event met repeatEnd === true
// - diamonds = diamondCount * repeatCount voor streaks
// - Schrijft naar giver_*/receiver_* kolommen in gifts-tabel

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import dotenv from "dotenv";

dotenv.config();

// Host uit .env (zoals jouw connector al doet)
const HOST_USERNAME = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .toLowerCase()
  .trim();

if (!HOST_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// Optioneel: simpele msgId-dedup voor zeldzame dubbele final-events
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000); // elke minuut schoonvegen

export function initGiftEngine(conn: any) {
  // Alleen het 'gift' event gebruiken
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    const giftName: string = data.giftName || "Onbekend";

    // Debug: ruwe gift binnen
    console.log(
      `\n[EVENT] GIFT ontvangen → msgId: ${msgId || "geen-id"} (${giftName})`
    );

    // Optionele extra-dedup, alleen voor safety
    if (msgId) {
      if (processedMsgIds.has(msgId)) {
        console.log(
          `⚠️  Duplicate FINAL gift genegeerd (msgId=${msgId}, gift=${giftName})`
        );
        return;
      }
    }

    try {
      // === 1. BASISVELDEN UIT EVENT ===
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const giftType: number = Number(data.giftType ?? 0); // 1 = streak
      const repeatEnd: boolean = Boolean(data.repeatEnd);
      const repeatCount: number = Number(data.repeatCount ?? 1);
      const rawDiamondCount: number = Number(data.diamondCount ?? 0);

      if (!rawDiamondCount || rawDiamondCount <= 0) {
        console.log("↪️  Gift zonder diamondCount → genegeerd");
        return;
      }

      // === 2. STREAK-LOGICA (giftType === 1) ===
      let creditedDiamonds = 0;

      if (giftType === 1) {
        if (!repeatEnd) {
          // Dit is een tussen-event in een streak → niet scoren
          console.log(
            `↪️  Streak bezig: ${giftName} x${repeatCount} (giftType=1, repeatEnd=false) → geen punten`
          );
          return;
        }

        // Laatste event van de streak → gebruik final repeatCount
        creditedDiamonds = rawDiamondCount * repeatCount;

        console.log(
          `✅  STREAK FINISHED: ${giftName} x${repeatCount} → ${creditedDiamonds}💎 (raw=${rawDiamondCount})`
        );
      } else {
        // Niet-streak gifts: elk event is 1 gift → direct scoren
        creditedDiamonds = rawDiamondCount;
        console.log(
          `✅  SINGLE GIFT: ${giftName} → ${creditedDiamonds}💎 (giftType=${giftType})`
        );
      }

      if (!creditedDiamonds || creditedDiamonds <= 0) {
        console.log("↪️  creditedDiamonds = 0 → geen update");
        return;
      }

      // msgId vanaf hier markeren als verwerkt
      if (msgId) {
        processedMsgIds.add(msgId);
      }

      // === 3. SENDER OPHALEN / AANMAKEN ===
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // === 4. ONTVANGER BEPALEN (HOST vs CO-HOST) ===
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

      const receiverDisplayRaw: string =
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        "";

      const isToHost =
        receiverUniqueId === HOST_USERNAME ||
        receiverUniqueId.includes(HOST_USERNAME) ||
        receiverDisplayRaw.toLowerCase().includes(HOST_USERNAME);

      let receiverName = HOST_USERNAME.toUpperCase();
      let receiverRole = "host";
      let receiverId: number | null = null;
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

      // === 5. LOGGING ===
      console.log(`🎁 GIFT (gift) DETECTED`);
      console.log(`   Van: ${sender.display_name} (@${sender.username})`);
      console.log(
        `   Aan: ${receiverName} (${receiverRole.toUpperCase()}) [host=@${HOST_USERNAME}]`
      );
      console.log(
        `   Gift: ${giftName} (${creditedDiamonds}💎, raw=${rawDiamondCount}, repeat=${repeatCount}, type=${giftType}, end=${repeatEnd})`
      );

      // === 6. PUNTEN & BP ===
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2; // ratio later tweakbaar naar 0.5
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // (Geen extra BP-log hier, addBP logt zelf al met → newBP)

      // === 7. ARENA-BONUS (alleen als gift NIET naar host gaat) ===
      if (!isToHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, creditedDiamonds);
          console.log(
            `   +${creditedDiamonds}💎 toegevoegd aan ARENA voor ${sender.display_name}`
          );
        }
      } else {
        console.log(`   ⚡ TWIST GIFT naar host → géén arena-update`);
      }

      // === 8. DATABASE SAVE ===
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
          creditedDiamonds,
          bpGain,
        ]
      );

      console.log("💾 Gift opgeslagen in database");
      console.log("=".repeat(80));
    } catch (err: any) {
      console.error("❌  GiftEngine error:", err?.message || err);
    }
  });

  console.log(
    `[GIFT ENGINE] ACTIEF → Host: @${HOST_USERNAME} (uit .env) – Alleen 'gift' event, streak-safe`
  );
}
