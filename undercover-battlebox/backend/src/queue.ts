// ============================================================================
// src/queue.ts — QUEUE ENGINE v16.1 CLEAN BUILD
// Position-based queue system (VIP/FAN aware)
// Compatibel met server.ts v15+ en alle admin dashboard acties
// ============================================================================

import pool from "./db";
import { io } from "./server";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Herschrijft ALLE posities naar een nette sequentie 1..N.
 */
export async function normalizePositions() {
  await pool.query(`
    WITH ordered AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY position ASC, id ASC) AS rn
      FROM queue
    )
    UPDATE queue q
    SET position = o.rn
    FROM ordered o
    WHERE q.id = o.id;
  `);
}

/**
 * Haal de volledige queue op
 */
export async function getQueue() {
  const result = await pool.query(
    `
    SELECT
      q.id,
      q.user_tiktok_id,
      q.boost_spots,
      q.position,
      q.joined_at,
      u.username,
      u.display_name,
      u.is_vip,
      u.vip_expires_at,
      u.is_fan,
      u.fan_expires_at
    FROM queue q
    JOIN users u ON u.tiktok_id = q.user_tiktok_id
    ORDER BY q.position ASC, q.id ASC
    `
  );

  const now = Date.now();

  return result.rows.map((row: any) => {
    const isVip = !!row.is_vip;
    const fanActive =
      row.is_fan &&
      row.fan_expires_at &&
      new Date(row.fan_expires_at).getTime() > now;

    const isFan = !!fanActive;
    const boost = Number(row.boost_spots) || 0;

    // UI reason label
    let reason = "";
    if (isVip) reason += "[VIP] ";
    if (isFan) reason += "[FAN] ";
    if (boost > 0) reason += `+Boost ${boost} `;
    if (!reason) reason = "Standaard";

    return {
      position: Number(row.position),
      tiktok_id: row.user_tiktok_id.toString(),
      display_name: row.display_name || "Onbekend",
      username: (row.username || "onbekend").replace(/^@+/, ""),
      priorityDelta: boost,
      is_vip: isVip,
      is_fan: isFan,
      reason,
    };
  });
}

/**
 * Emit queue naar alle admins
 */
export async function pushQueueUpdate() {
  await normalizePositions();
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// ============================================================================
// KERNFUNCTIES
// ============================================================================

/**
 * Wisselt twee posities
 */
async function swapPositions(idA: number, idB: number) {
  await pool.query(
    `
      UPDATE queue q SET position = CASE
        WHEN q.id = $1 THEN (SELECT position FROM queue WHERE id = $2)
        WHEN q.id = $2 THEN (SELECT position FROM queue WHERE id = $1)
      END
      WHERE q.id IN ($1, $2)
    `,
    [idA, idB]
  );

  await normalizePositions();
  await pushQueueUpdate();
}

/**
 * addToQueue — FAN verplicht, VIP krijgt boost (FIFO safe)
 */
export async function addToQueue(
  tiktok_id: string,
  username: string
): Promise<void> {
  const userTid = BigInt(tiktok_id);
  const cleanUsername = username.replace(/^@+/, "").toLowerCase();

  // oude entry weg
  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [userTid]);

  // user info
  const ur = await pool.query(
    `
    SELECT 
      display_name,
      username,
      is_fan,
      fan_expires_at,
      is_vip,
      vip_expires_at
    FROM users 
    WHERE tiktok_id=$1
    `,
    [userTid]
  );

  if (!ur.rows.length) {
    throw new Error("Gebruiker niet gevonden in database (users).");
  }

  const user = ur.rows[0];
  const now = Date.now();

  const fanActive =
    user.is_fan &&
    user.fan_expires_at &&
    new Date(user.fan_expires_at).getTime() > now;

  const isFan = !!fanActive;
  const isVip = !!user.is_vip;

  if (!isFan) {
    throw new Error("Gebruiker is geen actieve FAN (kan niet joinen).");
  }

  // nieuwe positie onderaan
  const qr = await pool.query(
    `SELECT COALESCE(MAX(position),0) AS maxpos FROM queue`
  );
  const startPos = Number(qr.rows[0].maxpos) + 1;

  const ir = await pool.query(
    `
      INSERT INTO queue (user_tiktok_id, boost_spots, joined_at, position)
      VALUES ($1, 0, NOW(), $2)
      RETURNING id, position
    `,
    [userTid, startPos]
  );

  const newId = ir.rows[0].id;
  let newPos = ir.rows[0].position;

  // VIP-boost (5 posities), maar FIFO veilig
  if (isVip) {
    const targetPos = Math.max(1, newPos - 5);

    const earlierVIPs = await pool.query(
      `
        SELECT id, position 
        FROM queue q 
        JOIN users u ON u.tiktok_id = q.user_tiktok_id
        WHERE u.is_vip = true
          AND q.position < $1
        ORDER BY q.position ASC
      `,
      [newPos]
    );

    let protectedVIPend = 0;
    if (earlierVIPs.rows.length) {
      protectedVIPend = Math.max(
        ...earlierVIPs.rows.map((v: any) => Number(v.position))
      );
    }

    const finalTarget = Math.max(targetPos, protectedVIPend + 1);

    if (finalTarget < newPos) {
      await pool.query(
        `
          UPDATE queue
          SET position = position + 1
          WHERE position >= $1 AND position < $2
        `,
        [finalTarget, newPos]
      );

      await pool.query(
        `UPDATE queue SET position=$1 WHERE id=$2`,
        [finalTarget, newId]
      );
    }
  }

  await normalizePositions();
  await pushQueueUpdate();
}

/**
 * removeFromQueue — admin verwijdert speler uit queue
 */
export async function removeFromQueue(tiktok_id: string): Promise<void> {
  const userTid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT id, position FROM queue WHERE user_tiktok_id=$1`,
    [userTid]
  );

  if (!r.rows.length) return;

  const entry = r.rows[0];
  const pos = Number(entry.position);

  await pool.query(`DELETE FROM queue WHERE id=$1`, [entry.id]);

  await pool.query(
    `
      UPDATE queue
      SET position = position - 1
      WHERE position > $1
    `,
    [pos]
  );

  await normalizePositions();
  await pushQueueUpdate();
}

/**
 * leaveQueue — !leave uit chat
 */
export async function leaveQueue(tiktok_id: string): Promise<number> {
  const userTid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT id, position, boost_spots FROM queue WHERE user_tiktok_id=$1`,
    [userTid]
  );

  if (!r.rows.length) return 0;

  const entry = r.rows[0];
  const boost = Number(entry.boost_spots);
  const pos = Number(entry.position);

  const refund = Math.floor(boost * 200 * 0.5);

  await pool.query(
    `
      UPDATE users 
      SET bp_total = bp_total + $1,
          bp_daily = bp_daily + $1
      WHERE tiktok_id=$2
    `,
    [refund, userTid]
  );

  await pool.query(`DELETE FROM queue WHERE id=$1`, [entry.id]);

  await pool.query(
    `
      UPDATE queue
      SET position = position - 1
      WHERE position > $1
    `,
    [pos]
  );

  await normalizePositions();
  await pushQueueUpdate();

  return refund;
}

/**
 * promoteQueue — speler één plek omhoog
 */
export async function promoteQueue(tiktok_id: string): Promise<void> {
  const tid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT id, position FROM queue WHERE user_tiktok_id=$1`,
    [tid]
  );
  if (!r.rows.length) return;

  const { id, position } = r.rows[0];
  const pos = Number(position);

  if (pos <= 1) return;

  const prev = await pool.query(
    `SELECT id FROM queue WHERE position=$1`,
    [pos - 1]
  );
  if (!prev.rows.length) return;

  const aboveId = prev.rows[0].id;

  // swap
  await swapPositions(id, aboveId);
}

/**
 * demoteQueue — speler één plek omlaag
 */
export async function demoteQueue(tiktok_id: string): Promise<void> {
  const tid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT id, position FROM queue WHERE user_tiktok_id=$1`,
    [tid]
  );
  if (!r.rows.length) return;

  const { id, position } = r.rows[0];
  const pos = Number(position);

  const maxR = await pool.query(`SELECT MAX(position) AS maxpos FROM queue`);
  const maxPos = Number(maxR.rows[0].maxpos);

  if (pos >= maxPos) return;

  const nxt = await pool.query(
    `SELECT id FROM queue WHERE position=$1`,
    [pos + 1]
  );
  if (!nxt.rows.length) return;

  const belowId = nxt.rows[0].id;

  // swap
  await swapPositions(id, belowId);
}

/**
 * addToArenaFromQueue — interne helper
 */
export async function addToArenaFromQueue(tiktok_id: string): Promise<void> {
  const tid = BigInt(tiktok_id);

  const r = await pool.query(
    `SELECT id, position FROM queue WHERE user_tiktok_id=$1`,
    [tid]
  );
  if (!r.rows.length) return;

  const pos = Number(r.rows[0].position);

  await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tid]);

  await pool.query(
    `
      UPDATE queue
      SET position = position - 1
      WHERE position > $1
    `,
    [pos]
  );

  await normalizePositions();
  await pushQueueUpdate();
}

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  getQueue,
  pushQueueUpdate,
  addToQueue,
  removeFromQueue,
  leaveQueue,
  promoteQueue,
  demoteQueue,
  addToArenaFromQueue,
  normalizePositions,
};
