// ============================================================================
// queue.ts — QUEUE ENGINE v3.3 (STRICT, NO USER CREATION, ARENA-PROTECT)
// ============================================================================
//
// ✔ Admin mag GEEN users aanmaken
// ✔ Alleen TikTok events creëren users
// ✔ Queue accepteert ALLEEN bestaande users
// ✔ Users in arena kunnen NIET in queue
// ✔ !join werkt alleen als niet in arena
// ✔ X-knop werkt: admin:removeFromQueue toegevoegd
// ✔ BigInt veilig
// ✔ addToQueue(tiktok_id) = 1 argument
//
// ============================================================================

import pool from "./db";
import { getArena } from "./engines/5-game-engine";

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

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
async function fetchUserByUsername(clean: string) {
  const r = await pool.query(
    `
    SELECT tiktok_id, username, display_name
    FROM users
    WHERE LOWER(username)=LOWER($1)
    LIMIT 1
  `,
    [clean]
  );
  return r.rows[0] || null;
}

async function fetchUserById(tiktok_id: string) {
  const r = await pool.query(
    `SELECT * FROM users WHERE tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// ARENA CHECK
// ---------------------------------------------------------------------------
function isInArena(tiktok_id: string): boolean {
  const arena = getArena();
  return arena.players.some((p) => String(p.id) === String(tiktok_id));
}

// ---------------------------------------------------------------------------
// ADD TO QUEUE — STRICT (ONLY EXISTING USERS, NOT IN ARENA)
// ---------------------------------------------------------------------------
export async function addToQueueByUsername(username: string): Promise<void> {
  const clean = username.replace("@", "").toLowerCase();
  const user = await fetchUserByUsername(clean);

  if (!user)
    throw new Error("User bestaat niet — nog nooit TikTok events ontvangen");

  return addToQueue(String(user.tiktok_id));
}

export async function addToQueue(tiktok_id: string): Promise<void> {
  const user = await fetchUserById(tiktok_id);
  if (!user) throw new Error("User bestaat niet — kan niet in queue");

  // Nieuw: user mag NIET in arena zitten
  if (isInArena(tiktok_id)) throw new Error("User zit al in de arena");

  // Nieuw: geblokkeerd?
  if (user.blocks?.queue) throw new Error("Geblokkeerd voor de queue");

  // Dubbel verwijderen
  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [BigInt(tiktok_id)]);

  // Toevoegen
  await pool.query(
    `
    INSERT INTO queue (user_tiktok_id, boost_spots)
    VALUES ($1,0)
  `,
    [BigInt(tiktok_id)]
  );
}

// ---------------------------------------------------------------------------
// REMOVE FROM QUEUE — ADMIN & CHAT
// ---------------------------------------------------------------------------
export async function removeFromQueueByUsername(username: string): Promise<boolean> {
  const clean = username.replace("@", "").toLowerCase();

  const r = await pool.query(
    `SELECT tiktok_id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [clean]
  );

  if (!r.rows.length) return false;

  const tid = String(r.rows[0].tiktok_id);

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [BigInt(tid)]);
  return true;
}

export async function removeFromQueueById(tiktok_id: string): Promise<boolean> {
  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [BigInt(tiktok_id)]);
  return true;
}

// ---------------------------------------------------------------------------
// BOOST
// ---------------------------------------------------------------------------
export async function boostQueue(tiktok_id: string, spots: number) {
  if (spots < 1 || spots > 5) throw new Error("Boost 1 t/m 5 plekken");

  const cost = spots * 200;
  const r = await pool.query(`SELECT bp_total FROM users WHERE tiktok_id=$1`, [BigInt(tiktok_id)]);

  if (!r.rows[0] || r.rows[0].bp_total < cost) throw new Error("Niet genoeg BP");

  await pool.query(`UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`, [cost, BigInt(tiktok_id)]);

  await pool.query(
    `UPDATE queue SET boost_spots = boost_spots + $1 WHERE user_tiktok_id=$2`,
    [spots, BigInt(tiktok_id)]
  );
}

// ---------------------------------------------------------------------------
// LEAVE QUEUE
// ---------------------------------------------------------------------------
export async function leaveQueue(tiktok_id: string): Promise<number> {
  const r = await pool.query(`SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`, [BigInt(tiktok_id)]);

  if (!r.rows[0]) return 0;

  const boost = r.rows[0].boost_spots;
  const refund = Math.floor(boost * 200 * 0.5);

  await pool.query(`UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id=$2`, [refund, BigInt(tiktok_id)]);

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [BigInt(tiktok_id)]);

  return refund;
}

// ---------------------------------------------------------------------------
// PRIORITY RULES
// ---------------------------------------------------------------------------
function calcPriority(isVip: boolean, boost: number) {
  return (isVip ? 5 : 0) + (boost || 0);
}

// ---------------------------------------------------------------------------
// GET QUEUE
// ---------------------------------------------------------------------------
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
    const fanValid = row.is_fan && row.fan_expires_at && new Date(row.fan_expires_at).getTime() > now;

    const vip = !!row.is_vip;
    const fan = !!fanValid;
    const boost = row.boost_spots || 0;

    const priority = calcPriority(vip, boost);

    let reason = "Standaard";
    if (vip) reason = "VIP";
    else if (fan) reason = "Fan";
    if (boost > 0) reason = `Boost +${boost}`;

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

  mapped.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
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
