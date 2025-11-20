// ============================================================================
// 2-user-engine.ts — v10.0 FULL
// Identity Engine + TikTok Normalizer + HARD HOST LOCK
// ============================================================================
//
// ✔ NOOIT meer UNKNOWN / Onbekend
// ✔ Host wordt NOOIT overschreven tijdens livestream
// ✔ Buiten livestream mag host normaal updaten
// ✔ Perfecte extractor: user, sender, receiver, toUser, userIdentity, _data
// ✔ Snelle upsert (1 query)
// ✔ BigInt safe
// ✔ 100% compatibel met giften, chat, reconnect, fallback
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

// ============================================================================
// UNIVERSAL IDENTITY EXTRACTOR — resolves ALL TikTok shapes
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
    raw?.senderId ||
    raw?.receiverId ||
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
// UPSERT IDENTITY (called from ALL engines)
// ============================================================================
export async function upsertIdentityFromLooseEvent(raw: any) {
  const { id, username, display } = extractIdentity(raw);
  if (!id) return;

  const hostId = getHardHostId();
  const isHost = hostId && String(hostId) === id;

  const cleanUsername = username || "unknown";
  const cleanDisplay = display || "Onbekend";

  // Hard Host Lock — tijdens livestream mag host GEEN username-update krijgen
  if (isHost && isStreamLive()) {
    await pool.query(
      `
      UPDATE users
      SET display_name = $1,
          last_seen_at = NOW()
      WHERE tiktok_id = $2
    `,
      [cleanDisplay, BigInt(id)]
    );
    return;
  }

  // Normale gebruikers — upsert
  await pool.query(
    `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (tiktok_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW()
    `,
    [BigInt(id), cleanUsername, cleanDisplay]
  );
}

// ============================================================================
// GET USER HELPERS
// ============================================================================

export async function getUserByTikTokId(id: string) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE tiktok_id=$1`,
    [BigInt(id)]
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
// UPSERT USER — direct calls
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

  // Hard Host Lock — tijdens livestream GEEN username-update
  if (isHost && isStreamLive()) {
    await pool.query(
      `
        UPDATE users
        SET display_name=$1,
            last_seen_at=NOW()
        WHERE tiktok_id=$2
      `,
      [cleanDisp, BigInt(tiktok_id)]
    );
    return;
  }

  await pool.query(
    `
      INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT(tiktok_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        last_seen_at = NOW()
    `,
    [BigInt(tiktok_id), cleanUser, cleanDisp]
  );
}

// ============================================================================
// MOST COMMON ENTRYPOINT (gift-engine, chat-engine, arena, queue)
// ============================================================================
export async function getOrUpdateUser(
  tiktokId: string,
  displayName?: string | null,
  username?: string | null
) {
  const id = String(tiktokId);

  let existing = await getUserByTikTokId(id);
  if (existing) return existing;

  // Create missing user
  await upsertUser(
    id,
    username || existing?.username || "unknown",
    displayName || existing?.display_name || "Onbekend"
  );

  return await getUserByTikTokId(id);
}

