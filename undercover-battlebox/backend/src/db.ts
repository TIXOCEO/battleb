// ============================================================================
// db.ts — v3.0 HOST PROFILES EDITION
// ============================================================================
import { Pool } from "pg";

const pool = new Pool({
  user: "battle",
  host: "localhost",
  database: "battlebox",
  password: "wqxcrr97",
  port: 5432,
});

// ============================================================================
// INIT DB
// ============================================================================
export async function initDB() {
  // USERS
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

  // QUEUE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue (
      id SERIAL PRIMARY KEY,
      user_tiktok_id TEXT REFERENCES users(tiktok_id),
      boost_spots INTEGER DEFAULT 0,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // SETTINGS (blijft nodig voor arena config)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // HOST PROFILES
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hosts (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      tiktok_id TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ DEFAULT NOW(),
      is_active BOOLEAN DEFAULT false
    );
  `);

  // DEFAULT SETTINGS
  const defaults: [string, string][] = [
    ["roundDurationPre", "180"],
    ["roundDurationFinal", "300"],
    ["graceSeconds", "5"],
    ["active_host_id", ""]
  ];

  for (const [key, value] of defaults) {
    await pool.query(
      `INSERT INTO settings(key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  // ========================================================================
  // MIGRATE OLD HOST INTO HOST PROFILES (only once)
  // ========================================================================
  const oldHostUsername = await getSetting("host_username");
  const oldHostId = await getSetting("host_id");
  const activeHostId = await getSetting("active_host_id");

  if (!activeHostId && oldHostUsername && oldHostId) {
    // check if exists already
    const exists = await pool.query(
      `SELECT id FROM hosts WHERE tiktok_id=$1`,
      [oldHostId]
    );

    let newId: number;

    if (exists.rows.length) {
      newId = exists.rows[0].id;
      await pool.query(
        `UPDATE hosts SET is_active=true, last_used_at=NOW()
         WHERE id=$1`,
        [newId]
      );
    } else {
      const ins = await pool.query(
        `
        INSERT INTO hosts (username, tiktok_id, display_name, is_active)
        VALUES ($1, $2, $3, true)
        RETURNING id
        `,
        [oldHostUsername, oldHostId, oldHostUsername]
      );
      newId = ins.rows[0].id;
    }

    await setSetting("active_host_id", String(newId));
    console.log("🔄 MIGRATION: Oud host-profiel overgezet → hosts(#" + newId + ")");
  }
}

// ============================================================================
// SETTINGS HELPERS
// ============================================================================
export async function getSetting(key: string): Promise<string | null> {
  const r = await pool.query(`SELECT value FROM settings WHERE key=$1`, [key]);
  return r.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await pool.query(
    `
    INSERT INTO settings(key, value)
    VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `,
    [key, value]
  );
}

// ============================================================================
// HOST PROFILE HELPERS
// ============================================================================
export async function getAllHosts() {
  const { rows } = await pool.query(
    `SELECT * FROM hosts ORDER BY last_used_at DESC NULLS LAST`
  );
  return rows;
}

export async function getActiveHost() {
  const activeId = await getSetting("active_host_id");
  if (!activeId) return null;

  const { rows } = await pool.query(
    `SELECT * FROM hosts WHERE id=$1`,
    [activeId]
  );

  return rows[0] || null;
}

export async function createOrUpdateHost(
  username: string,
  tiktok_id: string,
  display_name: string
) {
  // check existing
  const r = await pool.query(
    `SELECT id FROM hosts WHERE tiktok_id=$1`,
    [tiktok_id]
  );

  if (r.rows.length) {
    const id = r.rows[0].id;
    await pool.query(
      `
      UPDATE hosts
      SET username=$1, display_name=$2, last_used_at=NOW()
      WHERE id=$3
      `,
      [username, display_name, id]
    );
    return id;
  }

  // insert new
  const ins = await pool.query(
    `
    INSERT INTO hosts (username, tiktok_id, display_name, last_used_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
    `,
    [username, tiktok_id, display_name]
  );

  return ins.rows[0].id;
}

export async function setActiveHost(hostId: number) {
  // deactivate all
  await pool.query(`UPDATE hosts SET is_active=false`);

  // activate selected
  await pool.query(
    `UPDATE hosts SET is_active=true, last_used_at=NOW() WHERE id=$1`,
    [hostId]
  );

  // update settings
  await setSetting("active_host_id", String(hostId));
}

export default pool;
