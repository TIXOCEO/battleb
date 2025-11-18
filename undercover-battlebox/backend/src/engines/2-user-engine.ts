// src/engines/2-user-engine.ts
// USER ENGINE — versie 0.7.3 STABLE (BattleBox)
//
// Doelen:
//  - Onbekend minimaliseren
//  - Upgrades wanneer betere data binnenkomt
//  - last_seen_at altijd bijwerken
//  - Consistent met gift-engine, chat-engine, twist-engine & server
//
// Gebruikte kolommen (users):
// tiktok_id (bigint), display_name, username, last_seen_at,
// diamonds_total, bp_total, is_fan, fan_expires_at

import pool from "../db";

export interface UserIdentity {
  id: string;            // tiktok_id als string
  display_name: string;  // nette naam voor logs / UI
  username: string;      // zonder @, voor logica en matching
}

// Normalise username → altijd met @ in de database
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const raw =
    uid?.toString().trim() ||
    fallback?.toString().trim() ||
    "";

  if (!raw) return "";

  // Haal leading @ weg, maak lowercase, verwijder rare chars
  const clean = raw
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  if (!clean) return "";

  return clean.startsWith("@") ? clean : "@" + clean;
}

// Clean displayname voor UI
function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}

/**
 * Centrale user-upsert:
 *  - Wordt aangeroepen door gift-engine, chat-engine, server/twists
 *  - Zorgt dat username & display_name zo goed mogelijk zijn
 *  - Past bestaande records aan als betere data binnenkomt
 */
export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<UserIdentity> {
  if (!tiktok_id) {
    return {
      id: "??",
      display_name: "Onbekend",
      username: "onbekend",
    };
  }

  const tid = BigInt(tiktok_id);

  // Nieuwe (mogelijke) waarden uit event
  const newDisplay = cleanDisplay(nickname);
  const newUsernameFull = normalizeHandle(uniqueId, nickname);
  const newUsernameClean = newUsernameFull.replace(/^@+/, "");

  // Insert or update with UPSERT
  await pool.query(
    `
    INSERT INTO users (
      tiktok_id,
      display_name,
      username,
      diamonds_total,
      bp_total,
      last_seen_at,
      is_fan,
      fan_expires_at
    )
    VALUES ($1, $2, $3, 0, 0, NOW(), false, NULL)
    ON CONFLICT (tiktok_id)
    DO UPDATE SET
      display_name = CASE
        WHEN users.display_name LIKE 'Onbekend#%' OR EXCLUDED.display_name IS DISTINCT FROM users.display_name
        THEN EXCLUDED.display_name
        ELSE users.display_name
      END,
      username = CASE
        WHEN users.username LIKE '@onbekend%' OR EXCLUDED.username IS DISTINCT FROM users.username
        THEN EXCLUDED.username
        ELSE users.username
      END,
      last_seen_at = NOW()
    `,
    [tid, newDisplay || `Onbekend#${tiktok_id.slice(-5)}`, newUsernameFull || `@onbekend${tiktok_id.slice(-5)}`]
  );

  // Final lookup for clean return
  const res = await pool.query(
    `SELECT display_name, username FROM users WHERE tiktok_id=$1 LIMIT 1`,
    [tid]
  );

  const { display_name, username } = res.rows[0];

  return {
    id: tiktok_id,
    display_name: display_name || `Onbekend#${tiktok_id.slice(-5)}`,
    username: (username || "").replace(/^@+/, ""),
  };
}

/**
 * upsertIdentityFromLooseEvent
 * Wordt gebruikt als er een willekeurig TikTok event binnenkomt
 */
export async function upsertIdentityFromLooseEvent(loose: any): Promise<void> {
  if (!loose) return;

  const user =
    loose?.user ||
    loose?.sender ||
    loose?.toUser ||
    loose?.receiver ||
    loose;

  const id =
    user?.userId ||
    user?.id ||
    user?.uid ||
    user?.secUid ||
    null;

  if (!id) return;

  const display =
    user?.nickname ||
    user?.displayName ||
    undefined;

  const unique =
    user?.uniqueId ||
    user?.unique_id ||
    undefined;

  await getOrUpdateUser(String(id), display, unique);
}
