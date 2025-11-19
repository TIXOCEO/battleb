// ============================================================================
// db.ts — v2.0 FINAL MERGED
// Volledige tabelstructuren behouden + settings
// ============================================================================

import { Pool } from "pg";

const pool = new Pool({
  user: "battle",
  host: "localhost",
  database: "battlebox",
  password: "wqxcrr97",
  port: 5432,
});

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tiktok_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      diamonds_total DOUBLE PRECISION DEFAULT 0,
      bp_total DOUBLE PRECISION DEFAULT 0,
      bp_daily INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      badges TEXT[] DEFAULT '{}',
      blocks JSONB DEFAULT '{"queue":false,"twists":false,"boosters":false}',
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      is_fan BOOLEAN DEFAULT false,
      fan_expires_at TIMESTAMP NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue (
      id SERIAL PRIMARY KEY,
      user_tiktok_id TEXT REFERENCES users(tiktok_id),
      boost_spots INTEGER DEFAULT 0,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const defaults: [string, string][] = [
    ["host_username", ""],
    ["host_id", ""],
    ["roundDurationPre", "180"],
    ["roundDurationFinal", "300"],
    ["graceSeconds", "5"]
  ];

  for (const [key, value] of defaults) {
    await pool.query(
      `INSERT INTO settings(key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const r = await pool.query(`SELECT value FROM settings WHERE key=$1`, [key]);
  return r.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await pool.query(
    `INSERT INTO settings(key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

export default pool;
