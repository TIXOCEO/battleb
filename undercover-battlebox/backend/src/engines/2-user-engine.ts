// ============================================================================
// 2-user-engine.ts — v10.5 ULTRA
// Identity Engine + HARD HOST LOCK + Username Lock + HeartMe Fix
// ============================================================================
//
// ✔ Host wordt ALTIJD vooraf aangemaakt (server.ts patch)
// ✔ Host krijgt NOOIT meer "unknown"
// ✔ Tijdens livestream username LOCKED (display_name wél realtime update)
// ✔ extractIdentity / normalizers blijven 100% compatibel
// ✔ Geen logica verwijderd, alleen versterkt
//
// ============================================================================

import pool from "../db";
import {
  isStreamLive,
  getHardHostId,
  getHardHostUsername,
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
// UNIVERSAL EXTRACTOR
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
// GETTERS
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
// UPSERT FROM EVENT
// ============================================================================
export async function upsertIdentityFromLooseEvent(raw: any) {
  const { id, username, display } = extractIdentity(raw);
  if (!id) return;

  const hostId = getHardHostId();
  const lockedHostUsername = getHardHostUsername();
  const isHost = hostId && String(hostId) === id;

  const cleanDisplay = display || "Onbekend";
  let cleanUsername = username || "unknown";

  if (isHost) {
    const existing = await getUserByTikTokId(id);

    cleanUsername =
      existing?.username ||
      (lockedHostUsername ? normUsername(lockedHostUsername) : null) ||
      cleanUsername ||
      "unknown";
  }

  if (isHost && isStreamLive()) {
    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at, is_host)
      VALUES ($1, $2, $3, NOW(), NOW(), TRUE)
      ON CONFLICT (tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW(),
        is_host = TRUE
      `,
      [big(id), cleanUsername, cleanDisplay]
    );

    return;
  }

  await pool.query(
    `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at, is_host)
      VALUES ($1, $2, $3, NOW(), NOW(), $4)
      ON CONFLICT(tiktok_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW(),
        is_host = EXCLUDED.is_host
    `,
    [big(id), cleanUsername, cleanDisplay, isHost]
  );
}

// ============================================================================
// DIRECT UPSERT (admin, arena, queue)
// ============================================================================
export async function upsertUser(
  tiktok_id: string,
  username: string,
  display_name: string
) {
  const cleanUser = normUsername(username);
  const cleanDisp = normDisplay(display_name);

  const hostId = getHardHostId();
  const lockedHostUsername = getHardHostUsername();
  const isHost = hostId && String(hostId) === tiktok_id;

  if (isHost && isStreamLive()) {
    const existing = await getUserByTikTokId(tiktok_id);
    const finalUser =
      existing?.username ||
      (lockedHostUsername ? normUsername(lockedHostUsername) : cleanUser);

    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at, is_host)
      VALUES ($1, $2, $3, NOW(), NOW(), TRUE)
      ON CONFLICT (tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW(),
        is_host = TRUE
    `,
      [big(tiktok_id), finalUser, cleanDisp]
    );
    return;
  }

  await pool.query(
    `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at, is_host)
      VALUES ($1, $2, $3, NOW(), NOW(), $4)
      ON CONFLICT (tiktok_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW(),
        is_host = EXCLUDED.is_host
    `,
    [big(tiktok_id), cleanUser, cleanDisp, isHost]
  );
}

// ============================================================================
// MAIN ENTRY
// ============================================================================
export async function getOrUpdateUser(
  tiktokId: string,
  displayName?: string | null,
  username?: string | null
) {
  const id = String(tiktokId);

  let existing = await getUserByTikTokId(id);
  if (existing) return existing;

  await upsertUser(
    id,
    username || existing?.username || "unknown",
    displayName || existing?.display_name || "Onbekend"
  );

  return await getUserByTikTokId(id);
}
