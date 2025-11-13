// backend/src/db.ts — v1.1 SETTINGS + USERS + QUEUE
import { Pool } from "pg";

const pool = new Pool({
  user: "battle",
  host: "localhost",
  database: "battlebox",
  password: "wqxcrr97",
  port: 5432,
});

export default pool;

/* --------------------------------------------------------
   INIT DB — maakt alle tabellen indien nodig
-------------------------------------------------------- */
export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      tiktok_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bp_daily INTEGER DEFAULT 0,
      bp_total DOUBLE PRECISION DEFAULT 0,
      diamonds_total INTEGER DEFAULT 0,
      diamonds_stream INTEGER DEFAULT 0,
      diamonds_current_round INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      badges TEXT[] DEFAULT '{}',
      blocks JSONB DEFAULT '{"queue": false, "twists": false, "boosters": false}'
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

  /* SETTINGS-TABEL */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  /* FORCE DEFAULT VALUES IN SETTINGS */
  const defaults: [string, string][] = [
    ["host_username", ""],
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

/* --------------------------------------------------------
   SETTINGS HELPERS
-------------------------------------------------------- */

/** 1) Haal 1 waarde op */
export async function getSetting(key: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
    [key]
  );
  return res.rows[0]?.value ?? null;
}

/** 2) Zet 1 waarde */
export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings(key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

/** 3) Haal ALLE settings op (voor admin pagina + backend init) */
export async function getAllSettings(): Promise<Record<string, string>> {
  const res = await pool.query(`SELECT key, value FROM settings`);
  const out: Record<string, string> = {};
  for (const row of res.rows) out[row.key] = row.value;
  return out;
}
