// src/queue.ts — QUEUE ENGINE v2.2 FINAL
// Priority = VIP(5) + BOOST(X) — FAN heeft geen priority meer
// Fan blijft wél zichtbaar in UI en bepaald of iemand mag !join

import pool from "./db";

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

// ---------------------------------------------------------
// USER HELPERS
// ---------------------------------------------------------

async function createUser(tiktok_id: string, username: string) {
  const r = await pool.query(
    `
    INSERT INTO users (
      tiktok_id, username, display_name,
      is_fan, fan_expires_at,
      is_vip, bp_total, diamonds_total
    )
    VALUES ($1,$2,$2,false,NULL,false,0,0)
    RETURNING *
    `,
    [tiktok_id, username]
  );
  return r.rows[0];
}

async function getUser(tiktok_id: string) {
  const r = await pool.query(
    `SELECT * FROM users WHERE tiktok_id=$1`,
    [tiktok_id]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------
// ADD TO QUEUE
// ---------------------------------------------------------

export async function addToQueue(
  tiktok_id: string,
  username: string
): Promise<void> {
  let user = await getUser(tiktok_id);
  if (!user) user = await createUser(tiktok_id, username);

  if (user.blocks?.queue) throw new Error("Geblokkeerd van de queue");

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tiktok_id]);

  await pool.query(
    `INSERT INTO queue (user_tiktok_id, boost_spots)
     VALUES ($1,0)`,
    [tiktok_id]
  );
}

// ---------------------------------------------------------
// BOOST (fallback voor admin)
// De chat versie gebruikt boost-engine.ts → applyBoost()
// ---------------------------------------------------------

export async function boostQueue(
  tiktok_id: string,
  spots: number
): Promise<void> {
  if (spots < 1 || spots > 5)
    throw new Error("Boost 1 t/m 5 plekken");

  const cost = spots * 200;

  const r = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [tiktok_id]
  );

  if (!r.rows[0] || r.rows[0].bp_total < cost)
    throw new Error("Niet genoeg BP");

  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [cost, tiktok_id]
  );

  await pool.query(
    `UPDATE queue SET boost_spots = boost_spots + $1
     WHERE user_tiktok_id=$2`,
    [spots, tiktok_id]
  );
}

// ---------------------------------------------------------
// LEAVE QUEUE
// ---------------------------------------------------------

export async function leaveQueue(tiktok_id: string): Promise<number> {
  const r = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [tiktok_id]
  );

  if (!r.rows[0]) return 0;

  const boost = r.rows[0].boost_spots;
  const refund = Math.floor(boost * 200 * 0.5);

  await pool.query(
    `UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id=$2`,
    [refund, tiktok_id]
  );

  await pool.query(
    `DELETE FROM queue WHERE user_tiktok_id=$1`,
    [tiktok_id]
  );

  return refund;
}

// ---------------------------------------------------------
// NEW PRIORITY RULES (v2.2)
// VIP = +5
// FAN = +0
// BOOST = +X
// ---------------------------------------------------------

function calcPriority(isVip: boolean, boost: number): number {
  let p = 0;
  if (isVip) p += 5;
  p += boost || 0;
  return p;
}

// ---------------------------------------------------------
// GET QUEUE
// ---------------------------------------------------------

export async function getQueue(): Promise<QueueEntry[]> {
  const r = await pool.query(
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

  const mapped = r.rows.map((row: any) => {
    const fanValid =
      row.is_fan &&
      row.fan_expires_at &&
      new Date(row.fan_expires_at).getTime() > now;

    const vip = !!row.is_vip;
    const fan = !!fanValid;
    const boost = row.boost_spots || 0;

    const priority = calcPriority(vip, boost);

    let reason = "Standaard";
    if (vip) reason = "VIP";
    if (fan) reason = fan && !vip ? "Fan" : reason;

    if (boost > 0) {
      if (reason === "Standaard") reason = `Boost +${boost}`;
      else reason += ` + Boost`;
    }

    return {
      tiktok_id: row.user_tiktok_id.toString(),
      display_name: row.display_name,
      username: row.username,
      is_vip: vip,
      is_fan: fan,
      priorityDelta: boost,
      reason,
      priority,
      joined_at: row.joined_at,
    };
  });

  // Sort:
  // 1) priority DESC
  // 2) joined_at ASC
  mapped.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(a.joined_at).getTime() -
           new Date(b.joined_at).getTime();
  });

  return mapped.map((row, i) => ({
    position: i + 1,
    tiktok_id: row.tiktok_id,
    display_name: row.display_name,
    username: row.username,
    priorityDelta: row.priorityDelta,
    is_vip: row.is_vip,
    is_fan: row.is_fan,
    reason: row.reason,
  }));
}

export default getQueue;
