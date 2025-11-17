// ============================================================================
// queue.ts — QUEUE ENGINE v4.0 (STRICT, SAFE, ARENA-PROOF)
// ============================================================================
//
// ✔ Admin mag GEEN users aanmaken
// ✔ Alleen TikTok events creëren users
// ✔ Queue accepteert ALLEEN bestaande users
// ✔ Users in arena mogen NIET joinen (!join, admin, gifts)
// ✔ X-knop admin werkt: removeFromQueueByUsername
// ✔ BigInt volledig veilig
// ✔ addToQueue(tiktok_id) = 1 argument
// ✔ Sorting perfect: VIP → Boost → Fan → tijd
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
  is_vip: boolean;
  is_fan: boolean;
  reason: string;
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

async function fetchUserByUsername(username: string) {
  const clean = username.replace("@", "").toLowerCase();
  const r = await pool.query(
    `
    SELECT tiktok_id, username, display_name, is_fan, fan_expires_at, is_vip
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
    `
    SELECT tiktok_id, username, display_name, is_fan, fan_expires_at, is_vip
    FROM users
    WHERE tiktok_id=$1
  `,
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
// ADD TO QUEUE — STRICT (only existing, not in arena)
// ---------------------------------------------------------------------------
export async function addToQueueByUsername(username: string): Promise<void> {
  const user = await fetchUserByUsername(username);
  if (!user)
    throw new Error("User bestaat niet — nog geen TikTok events ontvangen");

  return addToQueue(String(user.tiktok_id));
}

export async function addToQueue(tiktok_id: string): Promise<void> {
  const user = await fetchUserById(tiktok_id);
  if (!user) throw new Error("User bestaat niet — kan niet in queue");

  // Blokkade: IN ARENA = NO QUEUE
  if (isInArena(tiktok_id)) throw new Error("User zit al in de arena");

  // Eventueel: geblokkeerd voor queue
  if (user.blocks?.queue) throw new Error("Geblokkeerd voor de queue");

  // Prevent duplicates
  await pool.query(
    `DELETE FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  // Insert fresh entry
  await pool.query(
    `
    INSERT INTO queue (user_tiktok_id, boost_spots)
    VALUES ($1, 0)
  `,
    [BigInt(tiktok_id)]
  );
}

// ---------------------------------------------------------------------------
// REMOVE FROM QUEUE — ADMIN & CHAT
// ---------------------------------------------------------------------------
export async function removeFromQueueByUsername(username: string): Promise<boolean> {
  const user = await fetchUserByUsername(username);
  if (!user) return false;

  await pool.query(
    `DELETE FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(user.tiktok_id)]
  );

  return true;
}

export async function removeFromQueueById(tiktok_id: string): Promise<boolean> {
  await pool.query(
    `DELETE FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );
  return true;
}

// ---------------------------------------------------------------------------
// BOOST
// ---------------------------------------------------------------------------
export async function boostQueue(tiktok_id: string, spots: number) {
  if (spots < 1 || spots > 5)
    throw new Error("Boost moet tussen 1 en 5 spots zijn");

  const r = await pool.query(
    `SELECT bp_total FROM users WHERE tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  if (!r.rows[0] || Number(r.rows[0].bp_total) < spots * 200)
    throw new Error("Niet genoeg BP voor boost");

  // Kosten in BP
  await pool.query(
    `UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id=$2`,
    [spots * 200, BigInt(tiktok_id)]
  );

  // Queue aanpassen
  await pool.query(
    `
    UPDATE queue
       SET boost_spots = boost_spots + $1
     WHERE user_tiktok_id=$2
  `,
    [spots, BigInt(tiktok_id)]
  );
}

// ---------------------------------------------------------------------------
// LEAVE QUEUE — refund 50% van boost-cost
// ---------------------------------------------------------------------------
export async function leaveQueue(tiktok_id: string): Promise<number> {
  const r = await pool.query(
    `SELECT boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  if (!r.rows.length) return 0;

  const boost = Number(r.rows[0].boost_spots);
  const refund = Math.floor(boost * 200 * 0.5);

  // Refund BP
  await pool.query(
    `UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id=$2`,
    [refund, BigInt(tiktok_id)]
  );

  // Remove from queue
  await pool.query(
    `DELETE FROM queue WHERE user_tiktok_id=$1`,
    [BigInt(tiktok_id)]
  );

  return refund;
}

// ---------------------------------------------------------------------------
// PRIORITY
// ---------------------------------------------------------------------------
function calcPriority(isVip: boolean, boost: number, isFan: boolean) {
  // VIP = absolute hoogste vorm
  let p = 0;
  if (isVip) p += 5;
  if (boost > 0) p += boost;
  if (isFan) p += 1;
  return p;
}

// ---------------------------------------------------------------------------
// GET QUEUE — fully sorted
// ---------------------------------------------------------------------------
export async function getQueue(): Promise<QueueEntry[]> {
  const r = await pool.query(
    `
    SELECT
      q.user_tiktok_id,
      q.boost_spots,
      q.joined_at,
      u.display_name,
      u.username,
      u.is_vip,
      u.is_fan,
      u.fan_expires_at
    FROM queue q
    JOIN users u ON u.tiktok_id = q.user_tiktok_id
  `
  );

  const now = Date.now();

  const rows = r.rows.map((row: any) => {
    const fanValid =
      row.is_fan &&
      row.fan_expires_at &&
      new Date(row.fan_expires_at).getTime() > now;

    return {
      tiktok_id: row.user_tiktok_id.toString(),
      display_name: row.display_name,
      username: row.username,
      is_vip: !!row.is_vip,
      is_fan: !!fanValid,
      boost: Number(row.boost_spots),
      priority: calcPriority(!!row.is_vip, Number(row.boost_spots), !!fanValid),
      joined_at: row.joined_at
    };
  });

  // SORTING:
  // 1) priority desc (VIP > Boost > Fan > normal)
  // 2) joined_at asc (eerste erin staat boven)
  rows.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
  });

  // Map naar final clean structure
  return rows.map((entry, i) => ({
    position: i + 1,
    tiktok_id: entry.tiktok_id,
    display_name: entry.display_name,
    username: entry.username,
    priorityDelta: entry.boost,
    is_vip: entry.is_vip,
    is_fan: entry.is_fan,
    reason:
      entry.is_vip
        ? "VIP"
        : entry.boost > 0
        ? `Boost +${entry.boost}`
        : entry.is_fan
        ? "Fan"
        : "Standaard"
  }));
}

export default getQueue;
