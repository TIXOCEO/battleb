// ============================================================================
// src/engines/7-boost-engine.ts — v3.0 FINAL
// Danny Goldenbelt / Undercover BattleBox
//
// ✔ Volledig compatible met nieuwe server.ts & queue.ts
// ✔ Verwijderd: emitQueue() (bestaat niet meer)
// ✔ Realtime queue updates via io.emit("updateQueue", …)
// ✔ 1-argument addToQueue support (tiktok_id ONLY)
// ✔ Boost kan alleen IN queue
// ✔ Boost kost 200 BP per plek
// ✔ Admin & Chat gebruiken dezelfde applyBoost()
// ✔ TypeScript 100% error-free
//
// ============================================================================

import pool from "../db";
import { io, emitLog } from "../server";
import { getQueue } from "../queue";

export const BOOST_COST = 200;         // BP per plek
export const MAX_CHAT_BOOST = 5;       // Max toelaatbaar via chat

// -------------------------
// RESULTAAT TYPE
// -------------------------
export type BoostOutcome = {
  success: boolean;
  message: string;
  newBoost?: number;
  cost?: number;
};

// ============================================================================
// APPLY BOOST  (centrale functie voor Admin + Chat)
// ============================================================================

export async function applyBoost(
  tiktok_id: string,
  spots: number,
  display_name: string
): Promise<BoostOutcome> {
  // Normaliseer spots
  if (spots < 1) spots = 1;
  if (spots > MAX_CHAT_BOOST) spots = MAX_CHAT_BOOST;

  const cost = spots * BOOST_COST;

  // --------------------------------------------------
  // CHECK BP SALDO
  // --------------------------------------------------
  const userRes = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  if (!userRes.rows[0]) {
    return { success: false, message: "Gebruiker bestaat niet." };
  }

  const bpNow = Number(userRes.rows[0].bp_total || 0);

  if (bpNow < cost) {
    return {
      success: false,
      message: `Niet genoeg BP (${bpNow}/${cost}).`,
    };
  }

  // --------------------------------------------------
  // CHECK OF GEBRUIKER IN QUEUE STAAT
  // --------------------------------------------------
  const qRes = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  if (!qRes.rows[0]) {
    return {
      success: false,
      message: "Je moet eerst in de wachtrij staan om te boosten.",
    };
  }

  // --------------------------------------------------
  // UPDATE BOOST
  // --------------------------------------------------
  const currentBoost = Number(qRes.rows[0].boost_spots || 0);
  const newBoost = currentBoost + spots;

  // BP afschrijven
  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [cost, BigInt(tiktok_id)]
  );

  // Queue-boost verhogen
  await pool.query(
    `
    UPDATE queue
       SET boost_spots = boost_spots + $1
     WHERE user_tiktok_id=$2
  `,
    [spots, BigInt(tiktok_id)]
  );

  // --------------------------------------------------
  // LOGGING (voor Admin Dashboard)
  // --------------------------------------------------
  emitLog({
    type: "booster",
    message: `${display_name} heeft +${spots} boost toegepast (totaal ${newBoost}). Kostte ${cost} BP.`,
  });

  // --------------------------------------------------
  // REALTIME QUEUE UPDATE
  // --------------------------------------------------
  io.emit("updateQueue", {
    open: true,
    entries: await getQueue(),
  });

  return {
    success: true,
    message: `Boost toegepast: +${spots} (totaal ${newBoost}).`,
    newBoost,
    cost,
  };
}

// ============================================================================
// CHAT PARSER — "!boost", "!boost 3", etc.
// ============================================================================

export async function parseBoostChatCommand(
  text: string
): Promise<number | null> {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith("!boost")) return null;

  const parts = lower.split(" ");
  if (parts.length === 1) return 1;  // "!boost" → 1 plek

  const amount = parseInt(parts[1]);
  if (isNaN(amount)) return 1;

  return Math.max(1, Math.min(MAX_CHAT_BOOST, amount));
}
