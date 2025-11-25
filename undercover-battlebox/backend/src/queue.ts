// ============================================================================
// src/queue.ts — QUEUE ENGINE v4.0 FINAL
// Fan-system + VIP priority + Boost logic + server v4.0 compatible
// ============================================================================

import pool from "./db";
import { io } from "./server";

// ---------------------------------------------------------------------------
// addToQueue()
// Wordt gebruikt door: chat-engine (!join), admin, twists
// ---------------------------------------------------------------------------
export async function addToQueue(tiktok_id: string, username: string): Promise<void> {
  const clean = username.replace(/^@+/, "").toLowerCase();
  const tid = BigInt(tiktok_id);

  // eerst duplicates verwijderen
  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tid]);

  // nieuwe queue entry
  await pool.query(
    `INSERT INTO queue (user_tiktok_id, boost_spots) VALUES ($1, 0)`,
    [tid]
  );

  await emitQueue();
}

// ---------------------------------------------------------------------------
// boostQueue() — fallback (admin)
// ---------------------------------------------------------------------------
export async function boostQueue(tiktok_id: string, spots: number): Promise<void> {
  const tid = BigInt(tiktok_id);

  if (spots < 1 || spots > 5) {
    throw new Error("Boost moet tussen 1 en 5 liggen.");
  }

  const cost = spots * 200;

  const r = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [tid]
  );

  if (!r.rows[0] || Number(r.rows[0].bp_total) < cost) {
    throw new Error("Niet genoeg BP");
  }

  // BP afboeken
  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [cost, tid]
  );

  // Boost opslaan
  await pool.query(
    `UPDATE queue SET boost_spots = boost_spots + $1 WHERE user_tiktok_id=$2`,
    [spots, tid]
  );

  await emitQueue();
}

// ---------------------------------------------------------------------------
// leaveQueue()
// Returned BP refund
// ---------------------------------------------------------------------------
export async function leaveQueue(tiktok_id: string): Promise<number> {
  const tid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [tid]
  );

  if (!r.rows[0]) return 0;

  const boost = Number(r.rows[0].boost_spots);
  const refund = Math.floor(boost * 200 * 0.5);

  await pool.query(
    `UPDATE users
     SET bp_total = bp_total + $1,
         bp_daily = bp_daily + $1
     WHERE tiktok_id=$2`,
    [refund, tid]
  );

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tid]);

  await emitQueue();

  return refund;
}

// ============================================================================
// PRIORITY SYSTEM
// VIP (5 punten) → FAN (3 punten) → Boost (n punten) → joined_at
// ============================================================================
function calcPriority(isVip: boolean, isFan: boolean, boost: number): number {
  return (isVip ? 5 : 0) + (isFan ? 3 : 0) + (boost || 0);
}

// ============================================================================
// GET FULL QUEUE (gematcht met jouw fan systeem)
// ============================================================================
export async function getQueue() {
  const result = await pool.query(
    `
    SELECT
      q.user_tiktok_id,
      q.boost_spots,
      q.joined_at,
      u.username,
      u.display_name,
      u.is_fan,
      u.fan_expires_at,
      u.is_vip
    FROM queue q
    JOIN users u ON u.tiktok_id = q.user_tiktok_id
    `
  );

  const now = Date.now();

  const items = result.rows.map((row: any) => {
    const fanActive =
      row.is_fan &&
      row.fan_expires_at &&
      new Date(row.fan_expires_at).getTime() > now;

    const isVip = !!row.is_vip;
    const isFan = !!fanActive;
    const boost = Number(row.boost_spots) || 0;

    const priority = calcPriority(isVip, isFan, boost);

    let reason = "";
    if (isVip) reason += "[VIP] ";
    if (isFan) reason += "[FAN] ";
    if (boost > 0) reason += `+Boost ${boost} `;
    if (reason === "") reason = "Standaard";

    return {
      tiktok_id: row.user_tiktok_id.toString(),
      display_name: row.display_name || "Onbekend",
      username: (row.username || "onbekend").replace(/^@+/, ""),
      joined_at: row.joined_at,
      boost,
      is_vip: isVip,
      is_fan: isFan,
      priority,
      reason: reason.trim(),
    };
  });

  // SORT: VIP > FAN > BOOST > time
  items.sort((a, b) => {
    if (a.is_vip !== b.is_vip) return Number(b.is_vip) - Number(a.is_vip);
    if (a.is_fan !== b.is_fan) return Number(b.is_fan) - Number(a.is_fan);
    if (a.boost !== b.boost) return b.boost - a.boost;
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  return items.map((item, i) => ({
    position: i + 1,
    tiktok_id: item.tiktok_id,
    display_name: item.display_name,
    username: item.username,
    priorityDelta: item.boost,
    is_vip: item.is_vip,
    is_fan: item.is_fan,
    reason: item.reason,
  }));
}

export default getQueue;
