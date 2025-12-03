// ============================================================================
// 2-user-engine.ts — v11.5 AVATAR UPGRADE (Danny Build)
// ============================================================================

import pool from "../db";
import { getActiveHost, isStreamLive } from "../server";

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
// UNIVERSAL IDENTITY EXTRACTOR (PATCHED — AVATAR SUPPORT)
// ============================================================================
function extractIdentity(raw: any) {
  if (!raw)
    return {
      id: null,
      username: null,
      display: null,
      avatar: null
    };

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
    null;

  const username =
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

  // ⭐ TikTok levert avatars via meerdere keys → wij pakken ALLES
  const avatar =
    u?.profilePictureUrl ||
    u?.avatarLarger ||
    u?.avatarMedium ||
    u?.avatarThumb ||
    raw?.profilePictureUrl ||
    raw?.avatarLarger ||
    raw?.avatarMedium ||
    raw?.avatarThumb ||
    null;

  return {
    id: id ? String(id) : null,
    username: username ? normUsername(username) : null,
    display: display ? normDisplay(display) : null,
    avatar
  };
}

// ============================================================================
// SIMPLE GETTERS
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
// UPSERT IDENTITY FROM ANY TIKTOK EVENT (PATCHED — AVATAR SUPPORT)
// ============================================================================
export async function upsertIdentityFromLooseEvent(raw: any) {
  const { id, username, display, avatar } = extractIdentity(raw);
  if (!id) return;

  const activeHost = getActiveHost();
  const isHost = activeHost && String(activeHost.id) === String(id);

  let finalUsername = username || "unknown";
  let finalDisplay = display || "Onbekend";
  const finalAvatar = avatar || null;

  if (isHost && isStreamLive()) {
    const existing = await getUserByTikTokId(id);
    finalUsername =
      existing?.username ||
      activeHost?.username ||
      finalUsername;

    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, avatar_url, last_seen_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT(tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        last_seen_at = NOW()
    `,
      [big(id), finalUsername, finalDisplay, finalAvatar]
    );
    return;
  }

  await pool.query(
    `
    INSERT INTO users (tiktok_id, username, display_name, avatar_url, last_seen_at)
    VALUES ($1,$2,$3,$4,NOW())
    ON CONFLICT(tiktok_id) DO UPDATE SET
      username     = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      last_seen_at = NOW()
  `,
    [big(id), finalUsername, finalDisplay, finalAvatar]
  );
}

// ============================================================================
// DIRECT UPSERT (PATCHED — OPTIONAL AVATAR)
// ============================================================================
export async function upsertUser(
  tiktok_id: string,
  username: string,
  display_name: string,
  avatar_url?: string | null
) {
  const cleanUser = normUsername(username);
  const cleanDisp = normDisplay(display_name);
  const avatar = avatar_url || null;

  const activeHost = getActiveHost();
  const isHost = activeHost && String(activeHost.id) === String(tiktok_id);

  if (isHost && isStreamLive()) {
    const existing = await getUserByTikTokId(tiktok_id);
    const finalUsername =
      existing?.username || activeHost?.username || cleanUser;

    await pool.query(
      `
      INSERT INTO users (tiktok_id, username, display_name, avatar_url, last_seen_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT(tiktok_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        last_seen_at = NOW()
    `,
      [big(tiktok_id), finalUsername, cleanDisp, avatar]
    );
    return;
  }

  await pool.query(
    `
    INSERT INTO users (tiktok_id, username, display_name, avatar_url, last_seen_at)
    VALUES ($1,$2,$3,$4,NOW())
    ON CONFLICT(tiktok_id) DO UPDATE SET
      username     = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      avatar_url   = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
      last_seen_at = NOW()
  `,
    [big(tiktok_id), cleanUser, cleanDisp, avatar]
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

  const activeHost = getActiveHost();
  const isHost = activeHost && String(activeHost.id) === id;

  const finalUsername =
    username ||
    (isHost
      ? activeHost?.username ||
        existing?.username ||
        "unknown"
      : existing?.username || "unknown");

  const finalDisplay =
    displayName ||
    (isHost
      ? existing?.display_name || "Onbekend"
      : existing?.display_name || "Onbekend");

  // We hebben hier geen avatar-informatie → laten we die null
  await upsertUser(id, finalUsername, finalDisplay, null);

  return await getUserByTikTokId(id);
}
