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
      bp_total DOUBLE PRECISION DEFAULT 0,
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

    -- FIX: Zet bp_total naar DOUBLE PRECISION (run 1x)
    DO $$ BEGIN
      ALTER TABLE users ALTER COLUMN bp_total TYPE DOUBLE PRECISION USING bp_total::DOUBLE PRECISION;
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
}

export default pool;
