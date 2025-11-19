// ============================================================================
// src/queue.ts — QUEUE ENGINE v3.0 FINAL
// Consistent met UserEngine + GiftEngine v6.2 + Server v3.6
// ----------------------------------------------------------------------------
// Verbeteringen:
// ✔ createUser verwijderd — ALLES via getOrUpdateUser()
// ✔ Consistente username/display_name correctie
// ✔ leaveQueue() stuurt nu altijd emitQueue()
// ✔ Priority sorting verbeterd (VIP > FAN > BOOST > tijd)
// ✔ Daily BP refund-optie toegevoegd (compatibel met jouw DB)
// ✔ 100% backwards-compatible met BattleBox gameplay
// ============================================================================

import pool from "./db";
import { getOrUpdateUser } from "./engines/2-user-engine";
import { emitQueue } from "./server";

export type QueueEntry = {
  position: number;
  tiktok_id: string;
  display_name: string;
  username: string;
  priorityDelta: number;
  reason: string;
  is_vip: boolean;
  is_fan: boolean;
};

// ============================================================================
// ADD TO QUEUE
// ============================================================================

export async function addToQueue(tiktok_id: string, username: string): Promise<void> {
  const clean = username.replace(/^@+/, "").toLowerCase();
  const tid = BigInt(tiktok_id);

  // Unified user creation via main user engine
  const user = await getOrUpdateUser(tiktok_id, clean, clean);

  if (user.blocks?.queue) {
    throw new Error("Geblokkeerd voor de queue");
  }

  // Remove duplicates first
  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tid]);

  // Add entry
  await pool.query(
    `INSERT INTO queue (user_tiktok_id, boost_spots) VALUES ($1, 0)`,
    [tid]
  );

  await emitQueue();
}

// ============================================================================
// BOOST (admin fallback)
// ============================================================================

export async function boostQueue(tiktok_id: string, spots: number): Promise<void> {
  const tid = BigInt(tiktok_id);

  if (spots < 1 || spots > 5) {
    throw new Error("Boost moet tussen 1 en 5 zijn");
  }

  const cost = spots * 200;

  const r = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [tid]
  );

  if (!r.rows[0] || Number(r.rows[0].bp_total) < cost) {
    throw new Error("Niet genoeg BP");
  }

  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [cost, tid]
  );

  await pool.query(
    `UPDATE queue SET boost_spots = boost_spots + $1 WHERE user_tiktok_id=$2`,
    [spots, tid]
  );

  await emitQueue();
}

// ============================================================================
// LEAVE QUEUE
// ============================================================================

export async function leaveQueue(tiktok_id: string): Promise<number> {
  const tid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [tid]
  );

  if (!r.rows[0]) return 0;

  const boost = Number(r.rows[0].boost_spots);
  const refund = Math.floor(boost * 200 * 0.5);

  // Refund both BP pools (optional but recommended)
  await pool.query(
    `UPDATE users SET bp_total = bp_total + $1, bp_daily = bp_daily + $1 WHERE tiktok_id=$2`,
    [refund, tid]
  );

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tid]);

  await emitQueue();

  return refund;
}

// ============================================================================
// PRIORITY LOGIC
// ============================================================================

function calcPriority(isVip: boolean, boost: number): number {
  return (isVip ? 5 : 0) + (boost || 0);
}

// ============================================================================
// GET FULL QUEUE
// ============================================================================

export async function getQueue(): Promise<QueueEntry[]> {
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
    const fanValid =
      row.is_fan &&
      row.fan_expires_at &&
      new Date(row.fan_expires_at).getTime() > now;

    const isVip = !!row.is_vip;
    const isFan = !!fanValid;
    const boost = Number(row.boost_spots) || 0;

    const priority = calcPriority(isVip, boost);

    let reason = isVip ? "VIP" : isFan ? "Fan" : "Standaard";
    if (boost > 0) reason += ` + Boost +${boost}`;

    return {
      tiktok_id: row.user_tiktok_id.toString(),
      display_name: row.display_name || `Onbekend#${row.user_tiktok_id.slice(-5)}`,
      username: row.username?.replace(/^@+/, "") || "onbekend",
      priorityDelta: boost,
      is_vip: isVip,
      is_fan: isFan,
      reason,
      joined_at: row.joined_at,
      priority,
    };
  });

  // Enhanced sort: VIP > FAN > BOOST > joined_at
  items.sort((a, b) => {
    if (a.is_vip !== b.is_vip) return b.is_vip - a.is_vip;
    if (a.is_fan !== b.is_fan) return b.is_fan - a.is_fan;
    if (a.priorityDelta !== b.priorityDelta) return b.priorityDelta - a.priorityDelta;

    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  return items.map((item, i) => ({
    position: i + 1,
    tiktok_id: item.tiktok_id,
    display_name: item.display_name,
    username: item.username,
    priorityDelta: item.priorityDelta,
    is_vip: item.is_vip,
    is_fan: item.is_fan,
    reason: item.reason,
  }));
}

export default getQueue;
