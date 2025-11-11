// src/engines/3-gift-engine.ts
// BATTLEBOX GIFT ENGINE — verwerkt TikTok gifts, boosters & arenapunten — 11 NOV 2025

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addBP } from "./4-points-engine";
import { arenaJoin, emitArena } from "./5-game-engine";
import { emitLog } from "../server";

// Types
interface GiftData {
  userId: string;
  uniqueId: string;
  nickname: string;
  giftId: string;
  giftName: string;
  diamondCount: number;
  repeatCount: number;
  repeatEnd: boolean;
}

// === BOOSTER CONFIG ===
// Bepaal hier welke gifts een speciale werking hebben
const BOOSTERS: Record<string, { name: string; bp: number; arenaBoost?: boolean }> = {
  "unicorn": { name: "Unicorn", bp: 50, arenaBoost: true },
  "rose": { name: "Rose", bp: 1 },
  "tiktok": { name: "TikTok", bp: 10 },
  "lion": { name: "Lion", bp: 100, arenaBoost: true },
};

// === INIT GIFT ENGINE ===
export function initGiftEngine(conn: any) {
  console.log("🎁 Gift engine actief – luistert naar gifts...");

  conn.on("gift", async (data: GiftData) => {
    try {
      const userId = data.userId?.toString();
      if (!userId || userId === "0") return;

      const giftName = data.giftName?.toLowerCase() || "unknown";
      const diamondValue = data.diamondCount * (data.repeatCount || 1);

      const user = await getOrUpdateUser(userId, data.nickname, data.uniqueId);

      // Controleer of gift een booster is
      const booster = BOOSTERS[giftName] ?? null;
      let bpEarned = booster ? booster.bp : Math.ceil(diamondValue / 10);

      await addBP(BigInt(userId), bpEarned, "GIFT", user.display_name);

      // Arena boost effect
      if (booster?.arenaBoost) {
        arenaJoin(userId, user.username, user.display_name, "booster");
        emitArena();
        emitLog({
          type: "booster",
          message: `@${user.username} activeerde ${booster.name} (+${bpEarned} BP & arena join)`,
        });
      } else {
        emitLog({
          type: "gift",
          message: `🎁 ${user.display_name} stuurde ${data.giftName} (${diamondValue}💎, +${bpEarned} BP)`,
        });
      }

      // Schrijf gift naar database
      await pool.query(
        `
        INSERT INTO gifts (tiktok_id, username, display_name, gift_name, diamonds, bp, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [userId, user.username, user.display_name, data.giftName, diamondValue, bpEarned]
      );
    } catch (err: any) {
      console.error("❌ GiftEngine error:", err.message);
    }
  });
}
