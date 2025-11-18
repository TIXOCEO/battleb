// ============================================================================
// 2-user-engine.ts — v1.0.1 (EmitLog, Host-ID Upgrade, Unknown→Known Fixes)
// Undercover BattleBox — User Identity Core
// ============================================================================
//
// Functies:
//  ✔ Houdt ALTIJD beste versie van username & display_name
//  ✔ Updatet bij elk event last_seen_at
//  ✔ Voorkomt Unknown spooknamen
//  ✔ Detecteert upgrades → emitLog() + console.log()
//  ✔ Werkt samen met host_id vanuit settings
//
// ============================================================================

import pool, { getSetting } from "../db";
import { emitLog } from "../server";

export interface UserIdentity {
  id: string;            // TikTok userId (string)
  display_name: string;  // nette naam voor UI
  username: string;      // zonder @
}

// ============================================================================
// Helpers
// ============================================================================

// Normaliseert usernames → altijd met @ in database
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const raw =
    uid?.toString().trim() ||
    fallback?.toString().trim() ||
    "";

  if (!raw) return "";

  const clean = raw
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  if (!clean) return "";

  return "@" + clean;
}

// display_name opschonen
function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}


// ============================================================================
// getOrUpdateUser() — centrale identity handler
// ============================================================================

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

  // Nieuwe data van TikTok event
  const newDisplay = cleanDisplay(nickname);
  const newUsernameFull = normalizeHandle(uniqueId, nickname);
  const newUsernameClean = newUsernameFull.replace(/^@/, "");

  // Check of deze user host is
  const hostIdSetting = await getSetting("host_id");
  const isHost = hostIdSetting && hostIdSetting === tiktok_id;

  // Instellingen voor unknown fallback
  const fallbackDisplay = `Onbekend#${tiktok_id.slice(-5)}`;
  const fallbackUsername = `@onbekend${tiktok_id.slice(-5)}`;

  // Database UPSERT
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
    [
      tid,
      newDisplay || fallbackDisplay,
      newUsernameFull || fallbackUsername,
    ]
  );

  // User terug ophalen
  const res = await pool.query(
    `SELECT display_name, username FROM users WHERE tiktok_id=$1 LIMIT 1`,
    [tid]
  );

  const row = res.rows[0] || {};

  const finalDisplay = row.display_name || fallbackDisplay;
  const finalUsername = (row.username || fallbackUsername).replace(/^@/, "");

  // ------------------------------------------------------------------------
  // Detecteer upgrades → stuur naar logs
  // ------------------------------------------------------------------------

  if (
    newDisplay &&
    newDisplay !== fallbackDisplay &&
    newDisplay !== row.display_name
  ) {
    emitLog({
      type: "user",
      message: `Naam update: ${fallbackDisplay} → ${newDisplay}`,
    });
    console.log(
      `👤 Display upgrade: ${fallbackDisplay} → ${newDisplay}`
    );
  }

  if (
    newUsernameFull &&
    newUsernameFull !== fallbackUsername &&
    newUsernameClean !== finalUsername
  ) {
    emitLog({
      type: "user",
      message: `Username update: ${fallbackUsername} → @${newUsernameClean}`,
    });
    console.log(
      `👤 Username upgrade: ${fallbackUsername} → @${newUsernameClean}`
    );
  }

  // ------------------------------------------------------------------------
  // Host fix — als TikTok ID == host_id → username mag NOOIT "onbekend" zijn
  // ------------------------------------------------------------------------
  if (isHost && finalUsername.startsWith("onbekend")) {
    console.log(`🏷 Host username hersteld → @${newUsernameClean}`);

    await pool.query(
      `
      UPDATE users
      SET username=$1
      WHERE tiktok_id=$2
      `,
      [newUsernameFull || fallbackUsername, tid]
    );
  }

  // Result terug
  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername,
  };
}


// ============================================================================
// upsertIdentityFromLooseEvent()
// ============================================================================

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
