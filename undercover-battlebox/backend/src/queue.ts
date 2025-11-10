// backend/src/queue.ts
import pool from './db';
import { User } from './types';

export type QueueEntry = {
  position: number;
  user: {
    username: string;
    badges: string[];
    priority: number;
  };
  boost_spots: number;
};

export async function addToQueue(tiktok_id: string, username: string): Promise<void> {
  let user = await getUser(tiktok_id);
  if (!user) {
    user = await createUser(tiktok_id, username);
  }
  if (user.blocks?.queue) throw new Error('Geblokkeerd in queue');

  await pool.query('DELETE FROM queue WHERE user_tiktok_id = $1', [tiktok_id]);
  await pool.query(
    'INSERT INTO queue (user_tiktok_id, boost_spots) VALUES ($1, 0)',
    [tiktok_id]
  );
}

export async function boostQueue(tiktok_id: string, spots: number): Promise<void> {
  if (spots < 1 || spots > 5) throw new Error('Boost 1-5 plekken');

  const cost = spots * 200;
  const userRes = await pool.query('SELECT bp_total FROM users WHERE tiktok_id = $1', [tiktok_id]);
  if (!userRes.rows[0] || userRes.rows[0].bp_total < cost) {
    throw new Error('Niet genoeg BP');
  }

  await pool.query('UPDATE users SET bp_total = bp_total - $1 WHERE tiktok_id = $2', [cost, tiktok_id]);
  await pool.query(
    'UPDATE queue SET boost_spots = boost_spots + $1 WHERE user_tiktok_id = $2',
    [spots, tiktok_id]
  );
}

export async function leaveQueue(tiktok_id: string): Promise<number> {
  const res = await pool.query('SELECT boost_spots FROM queue WHERE user_tiktok_id = $1', [tiktok_id]);
  if (res.rows.length === 0) return 0;

  const boost_spots = res.rows[0].boost_spots;
  const refund = Math.floor(boost_spots * 200 * 0.5);

  await pool.query('UPDATE users SET bp_total = bp_total + $1 WHERE tiktok_id = $2', [refund, tiktok_id]);
  await pool.query('DELETE FROM queue WHERE user_tiktok_id = $1', [tiktok_id]);

  return refund;
}

function calculatePriority(badges: string[] = [], boost_spots: number): number {
  let priority = boost_spots;
  if (badges.includes('superfan')) priority += 10;
  if (badges.includes('fanclub')) priority += 5;
  if (badges.includes('vip')) priority += 10;
  return priority;
}

export async function getQueue(): Promise<QueueEntry[]> {
  const res = await pool.query(`
    SELECT u.username, u.badges, q.boost_spots
    FROM queue q
    JOIN users u ON q.user_tiktok_id = u.tiktok_id
    ORDER BY 
      q.boost_spots +
      (CASE WHEN 'superfan' = ANY(u.badges) THEN 10 ELSE 0 END) +
      (CASE WHEN 'fanclub' = ANY(u.badges) THEN 5 ELSE 0 END) +
      (CASE WHEN 'vip' = ANY(u.badges) THEN 10 ELSE 0 END) DESC,
      q.joined_at ASC
  `);

  return res.rows.map((row, index) => ({
    position: index + 1,
    user: {
      username: row.username,
      badges: row.badges || [],
      priority: calculatePriority(row.badges || [], row.boost_spots)
    },
    boost_spots: row.boost_spots
  }));
}

async function getUser(tiktok_id: string): Promise<User | null> {
  const res = await pool.query('SELECT * FROM users WHERE tiktok_id = $1', [tiktok_id]);
  return res.rows[0] || null;
}

async function createUser(tiktok_id: string, username: string): Promise<User> {
  const res = await pool.query(
    'INSERT INTO users (tiktok_id, username, badges, blocks, bp_total) VALUES ($1, $2, $3, $4, 0) RETURNING *',
    [tiktok_id, username, [], '{}']
  );
  return res.rows[0];
}

// queue.ts — VOEG DIT TOE ONDERAAN HET BESTAND
import { io } from './server';

export function emitQueue() {
  io.emit('queue:update', getQueue());
}
