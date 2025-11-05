// backend/src/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  user: 'battle',
  host: 'localhost',
  database: 'battlebox',
  password: 'wqxcrr97',
  port: 5432,
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tiktok_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      bp_daily INTEGER DEFAULT 0,
      bp_total INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      badges TEXT[] DEFAULT '{}',
      blocks JSONB DEFAULT '{"queue": false, "twists": false, "boosters": false}'
    );

    CREATE TABLE IF NOT EXISTS queue (
      id SERIAL PRIMARY KEY,
      user_tiktok_id TEXT REFERENCES users(tiktok_id),
      boost_spots INTEGER DEFAULT 0,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export default pool;
