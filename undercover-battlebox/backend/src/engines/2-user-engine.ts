// ============================================================================
// 2-user-engine.ts — v11.0 HOST PROFILES EDITION
// Identity Engine + TikTok Universal Normalizer + HARD HOST LOCK
// ============================================================================
//
// ✔ 100% compatibel met nieuwe hosts-tabel
// ✔ Haalt actieve host op via server.ts → getActiveHost()
// ✔ Hard host lock blijft actief (geen username updates tijdens live)
// ✔ Host username komt nu uit host-profiel, niet meer uit settings
// ✔ Display name van host wordt wel live geüpdatet
// ✔ extractIdentity vangt ALLE TikTok structuren
// ✔ Normal users blijven dezelfde flow volgen
// ✔ Snelle UPSERT (1 query)
// ----------------------------------------------------------------------------

import pool from "../db";
import {
  isStreamLive,
  getActiveHost, // <── NIEUW
} from "../server";

// ============================================================================
// NORMALIZERS
// ============================================================================

function normUsername(v: any): string {
  return (v || "")
    .toString()
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 32);
}

function normDisplay(v: any): string {
  if (!v) return "Onbekend";
  return String(v).trim().slice(0, 48);
}

function big(v: string | number): bigint {
  try {
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

// ============================================================================
// UNIVERSAL IDENTITY EXTRACTOR — catches ALL TikTok variants
// ============================================================================
function extractIdentity(raw: any) {
  if (!raw) return { id: null, username: null, display: null };

  const u =
    raw.user ||
    raw.sender ||
    raw.receiver ||
    raw.toUser ||
    raw.userIdentity ||
    raw._data ||
    raw;

  const id =
    u?.userId ||
    u?.id ||
    u?.uid ||
    raw?.userId ||
    raw?.receiverId ||
    raw?.senderId ||
    u?.user_id ||
    u?.secUid ||
    null;

  const unique =
    u?.uniqueId ||
    u?.unique_id ||
    raw?.uniqueId ||
    raw?.unique_id ||
    u?.secUid ||
    null;

  const display =
    u?.nickname ||
    u?.displayName ||
    raw?.nickname ||
    raw?.displayName ||
    null;

  return {
    id: id ? String(id) : null,
    username: unique ? normUsername(unique) : null,
    display: display ? normDisplay(display) : null,
  };
}

// ============================================================================
// USER GETTERS
// ============================================================================
export async function getUserByTikTokId(id: string) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE tiktok_id=$1`,
    [big(id)]
  );
  return rows[0] || null;
}

export async function getUserByUsername(username: string) {
  const clean = normUsername(username);
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE username=$1`,
    [clean]
  );
  return rows[0] || null;
}

// ============================================================================
// UPSERT IDENTITY (main entrypoint from gift/chat engines)
// ============================================================================
export async function upsertIdentityFromLooseEvent(raw: any) {
  const { id, username, display } = extractIdentity(raw);
  if (!id) return;

  // === NIEUW HOST-PROFILE BLOCK ============================================
  const activeHost = getActiveHost(); // { id, username, display_name }
  const isHost = activeHost && String(activeHost.id) === String(id);
  const lockedHostUsername = activeHost?.username || "";
  // ==========================================================================

  const cleanDisplay = display || "Onbekend";
  let cleanUsername = username || "unknown";

  // HOST: voorkom verkeerde username
  if (isHost) {
    const existing = await getUserByTikTokId(id);

    if (existing?.username) {
      cleanUsername = existing.username;
    } else if (lockedHostUsername) {
      cleanUsername = normUsername(lockedHostUsername);
    } else if (username) {
      cleanUsername = username;
    } else {
      cleanUsername = "unknown";
    }
  }

  // HARD LOCK — tijdens livestream mag host GEEN username update krijgen
  if (isHost && isStreamLive()) {
    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW()
      `,
      [big(id), cleanUsername, cleanDisplay]
    );
    return;
  }

  // Normale user of host buiten livestream
  await pool.query(
    `
    INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT (tiktok_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      last_seen_at = NOW()
  `,
    [big(id), cleanUsername, cleanDisplay]
  );
}

// ============================================================================
// DIRECT UPSERT — used by admin, queue, arena
// ============================================================================
export async function upsertUser(
  tiktok_id: string,
  username: string,
  display_name: string
) {
  const cleanUser = normUsername(username);
  const cleanDisp = normDisplay(display_name);

  const activeHost = getActiveHost();
  const isHost =
    activeHost && String(activeHost.id) === String(tiktok_id);
  const lockedHostUsername = activeHost?.username || "";

  // HARD LOCK tijdens live
  if (isHost && isStreamLive()) {
    const existing = await getUserByTikTokId(tiktok_id);

    const finalUsername =
      existing?.username ||
      (lockedHostUsername ? normUsername(lockedHostUsername) : cleanUser);

    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW()
      `,
      [big(tiktok_id), finalUsername, cleanDisp]
    );
    return;
  }

  // Normale user of host buiten stream
  await pool.query(
    `
    INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT(tiktok_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      last_seen_at = NOW()
  `,
    [big(tiktok_id), cleanUser, cleanDisp]
  );
}

// ============================================================================
// MAIN ENTRY FOR ENGINES — getOrUpdateUser
// ============================================================================
export async function getOrUpdateUser(
  tiktokId: string,
  displayName?: string | null,
  username?: string | null
) {
  const id = String(tiktokId);

  let existing = await getUserByTikTokId(id);
  if (existing) return existing;

  const activeHost = getActiveHost();
  const isHost = activeHost && String(activeHost.id) === String(id);

  const finalUsername =
    username ||
    (isHost
      ? activeHost?.username || existing?.username || "unknown"
      : existing?.username || "unknown");

  const finalDisplay =
    displayName ||
    (isHost
      ? activeHost?.display_name || "Onbekend"
      : existing?.display_name || "Onbekend");

  await upsertUser(id, finalUsername, finalDisplay);

  return await getUserByTikTokId(id);
}
