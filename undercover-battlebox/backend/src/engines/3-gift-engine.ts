// src/engines/3-gift-engine.ts
// GIFT ENGINE — v2.0 (Heart Me → Fanclub)

import pool from "../db";
import { emitLog } from "../server";
import { getArena } from "./5-game-engine";
import { addDiamonds } from "./4-points-engine";
import { getOrUpdateUser } from "./2-user-engine";

const HEART_ME_NAME = "Heart Me";
const FAN_DURATION_HOURS = 24;

export function initGiftEngine(conn: any) {
  console.log("🎁 GIFT ENGINE v2.0 LOADED");

  conn.on("gift", async (gift: any) => {
    try {
      const giverId = String(gift.userId || gift.uniqueId || gift.user?.userId);
      if (!giverId) return;

      const giverName =
        gift.nickname || gift.user?.nickname || gift.sender?.nickname;
      const giverUsername =
        gift.uniqueId || gift.user?.uniqueId || gift.sender?.uniqueId;

      const giftName = gift.giftName || gift.gift?.name;
      const diamondCount = Number(gift.diamondCount || gift.gift?.diamondCount || 0);

      const user = await getOrUpdateUser(giverId, giverName, giverUsername);

      // LOGGING
      emitLog({
        type: "gift",
        message: `${user.display_name} stuurde ${giftName} (${diamondCount}💎)`
      });

      // Heart Me → fanclub 24h
      if (giftName === HEART_ME_NAME) {
        const expires = new Date(Date.now() + FAN_DURATION_HOURS * 60 * 60 * 1000);

        await pool.query(
          `
            UPDATE users
            SET is_fan = TRUE,
                fan_expires_at = $1
            WHERE tiktok_id=$2
          `,
          [expires, giverId]
        );

        emitLog({
          type: "system",
          message: `${user.display_name} is nu fan voor 24 uur`
        });
      }

      // Diamonds → Arena speler update
      if (diamondCount > 0) {
        await addDiamonds(giverId, diamondCount);
      }
    } catch (err) {
      console.error("Gift engine error:", err);
    }
  });
}

export async function refreshHostUsername() {}
export async function initDynamicHost() {}
