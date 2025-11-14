// src/engines/7-boost-engine.ts
// BOOST ENGINE – v1.2 (Chat + Admin)
// -----------------------------------
// - Chat command: !boost of !boost 3
// - Kost 200 BP per plek
// - Alleen mogelijk als gebruiker IN de queue staat
// - Alleen mogelijk als gebruiker genoeg BP heeft
// - Werk volledig samen met queue.ts en server.ts
// - emitQueue() voor realtime update
// - emitLog() voor admin-dashboard

import pool from "../db";
import { emitLog, emitQueue } from "../server";

export const BOOST_COST = 200;          // BP per plek
export const MAX_CHAT_BOOST = 5;        // Geen gekke waarden uit chat

export type BoostOutcome = {
  success: boolean;
  message: string;
  newBoost?: number;
  cost?: number;
};

// -------------------------
// HOOFDFUNCTIE (door Admin of Chat)
// -------------------------
export async function applyBoost(
  tiktok_id: string,
  spots: number,
  display_name: string
): Promise<BoostOutcome> {
  if (spots < 1) spots = 1;
  if (spots > MAX_CHAT_BOOST) spots = MAX_CHAT_BOOST;

  const cost = spots * BOOST_COST;

  // Check BP saldo
  const userRes = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [tiktok_id]
  );

  if (!userRes.rows[0]) {
    return { success: false, message: "Gebruiker bestaat niet." };
  }

  const bpNow = Number(userRes.rows[0].bp_total || 0);
  if (bpNow < cost) {
    return {
      success: false,
      message: `Je hebt niet genoeg BP. (${bpNow}/${cost})`,
    };
  }

  // Check of user in queue staat
  const qRes = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [tiktok_id]
  );

  if (!qRes.rows[0]) {
    return {
      success: false,
      message: "Je moet eerst in de wachtrij staan voordat je kunt boosten.",
    };
  }

  const currentBoost = Number(qRes.rows[0].boost_spots || 0);
  const newBoost = currentBoost + spots;

  // BP aftrekken
  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [cost, tiktok_id]
  );

  // Queue boost updaten
  await pool.query(
    `UPDATE queue
     SET boost_spots = boost_spots + $1
     WHERE user_tiktok_id=$2`,
    [spots, tiktok_id]
  );

  // Dashboard Log
  emitLog({
    type: "booster",
    message: `${display_name} boosted de wachtrij met +${spots} (${newBoost} totaal). Kostte ${cost} BP.`,
  });

  // Realtime update
  await emitQueue();

  return {
    success: true,
    message: `Boost toegepast: +${spots}. Nieuw totaal: ${newBoost}`,
    newBoost,
    cost,
  };
}

// ----------------------------------------------------------
// Chat parser: !boost      → +1
//              !boost 3    → +3
// ----------------------------------------------------------
export async function parseBoostChatCommand(
  text: string
): Promise<number | null> {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith("!boost")) return null;

  const parts = lower.split(" ");
  if (parts.length === 1) return 1;      // "!boost" = 1 plek
  const amount = parseInt(parts[1]);

  if (isNaN(amount)) return 1;
  return Math.max(1, Math.min(MAX_CHAT_BOOST, amount));
}
