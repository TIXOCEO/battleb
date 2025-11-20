// ============================================================================
// 2-user-engine.ts — v10.1 FINAL
// Identity Engine + TikTok Universal Normalizer + HARD HOST LOCK (OPTIE B)
// ============================================================================
//
// ✔ Geen UNKNOWN meer
// ✔ Extractor vangt ALLE TikTok structuren (gift/chat/fallback)
// ✔ Hard host lock: tijdens livestream GEEN username updates
// ✔ Buiten livestream wél username update toegestaan
// ✔ Displayname wordt ALTIJD live geüpdatet
// ✔ BigInt veilig
// ✔ Snelle upsert (1 query)
// ✔ 100% compatibel met al jouw engines
//
// ============================================================================

import pool from "../db";
import { isStreamLive, getHardHostId } from "../server";

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

  // TikTok ID (priority based on real patterns)
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

  // Username
  const unique =
    u?.uniqueId ||
    u?.unique_id ||
    raw?.uniqueId ||
    raw?.unique_id ||
    u?.secUid /* sometimes appears as fallback */ ||
    null;

  // Display name
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
// UPSERT IDENTITY (main entrypoint from gift/chat engines)
// ============================================================================
export async function upsertIdentityFromLooseEvent(raw: any) {
  const { id, username, display } = extractIdentity(raw);
  if (!id) return;

  const hostId = getHardHostId();
  const isHost = hostId && String(hostId) === id;

  const cleanUsername = username || "unknown";
  const cleanDisplay = display || "Onbekend";

  // HARD HOST LOCK (OPTIE B)
  // Tijdens livestream MAG host GEEN username-update krijgen
  if (isHost && isStreamLive()) {
    await pool.query(
      `
      UPDATE users
      SET display_name = $1,
          last_seen_at = NOW()
      WHERE tiktok_id = $2
      `,
      [cleanDisplay, big(id)]
    );
    return;
  }

  // Normale users (of host buiten livestream)
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
// DIRECT UPSERT — called manually (arena, queue, admin)
// ============================================================================
export async function upsertUser(
  tiktok_id: string,
  username: string,
  display_name: string
) {
  const cleanUser = normUsername(username);
  const cleanDisp = normDisplay(display_name);

  const hostId = getHardHostId();
  const isHost = hostId && String(hostId) === tiktok_id;

  // HARD HOST LOCK (OPTIE B)
  if (isHost && isStreamLive()) {
    await pool.query(
      `
      UPDATE users
      SET display_name=$1,
          last_seen_at=NOW()
      WHERE tiktok_id=$2
    `,
      [cleanDisp, big(tiktok_id)]
    );
    return;
  }

  // Normal upsert
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
// MAIN ENTRY FOR ENGINES (gift-engine, chat-engine, arena actions)
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
