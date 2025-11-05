// backend/src/queue.ts
import pool from './db';
import { User, QueueEntry } from './types';

export async function addToQueue(tiktok_id: string, username: string, boost = 0): Promise<QueueEntry> {
  let user = await getUser(tiktok_id);
  if (!user) {
    user = await createUser(tiktok_id, username);
  }

  if (user.blocks.queue) throw new Error('Geblokkeerd in queue');

  // Verwijder bestaande
  await pool.query('DELETE FROM queue WHERE user_tiktok_id = $1', [tiktok_id]);

  const res = await pool.query(
    'INSERT INTO queue (user_tiktok_id, boost_spots) VALUES ($1, $2) RETURNING *',
    [tiktok_id, boost]
  );

  return { user, boost_spots: res.rows[0].boost_spots };
}

export async function getQueue(): Promise<QueueEntry[]> {
  const res = await pool.query(`
    SELECT u.*, q.boost_spots 
    FROM queue q 
    JOIN users u ON q.user_tiktok_id = u.tiktok_id 
    ORDER BY q.joined_at ASC
  `);
  return res.rows.map(r => ({
    user: {
      id: r.id,
      username: r.username,
      tiktok_id: r.tiktok_id,
      bp_daily: r.bp_daily,
      bp_total: r.bp_total,
      streak: r.streak,
      priority: calculatePriority(r.badges, r.boost_spots),
      badges: r.badges,
      blocks: r.blocks
    },
    boost_spots: r.boost_spots
  }));
}

function calculatePriority(badges: string[], boost: number): number {
  let prio = 0;
  if (badges.includes('superfan')) prio += 10;
  else if (badges.includes('fanclub')) prio += 5;
  else if (badges.includes('vip')) prio += 5;
  prio += Math.min(boost, 5); // max +5
  return prio;
}

async function getUser(tiktok_id: string): Promise<User | null> {
  const res = await pool.query('SELECT * FROM users WHERE tiktok_id = $1', [tiktok_id]);
  return res.rows[0] || null;
}

async function createUser(tiktok_id: string, username: string): Promise<User> {
  const res = await pool.query(
    'INSERT INTO users (tiktok_id, username) VALUES ($1, $2) RETURNING *',
    [tiktok_id, username]
  );
  return res.rows[0];
}
