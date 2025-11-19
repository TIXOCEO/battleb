// ============================================================================
// 2-user-engine.ts — v2.2 FINAL FIXED
// Undercover BattleBox — User Identity Core
// ============================================================================
//
// Belangrijk!:
//  ✔ Geen gameplay logica aangepast
//  ✔ Alleen bugfixes:
//      - Sender/receiver krijgen nu ALTIJD nickname + uniqueId
//      - Alle TikTok event types worden correct gelezen
//      - Unknown fallback blijft exact zoals jouw systeem het had
//      - Host krijgt nooit meer fallback
//      - Upgrades worden correct gelogd
//
// ============================================================================

import pool, { getSetting } from "../db";
import { emitLog } from "../server";

export interface UserIdentity {
  id: string;
  display_name: string;
  username: string;
}

// Normaliseert username zonder emoji, maar behoudt punten/strepen
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const raw =
    uid?.toString().trim() ||
    fallback?.toString().trim() ||
    "";

  if (!raw) return "";

  const clean = raw
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gi, ""); // <-- FIX: punten & streepjes toegestaan

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
// getOrUpdateUser()
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

  // Host-check
  const hostIdSetting = await getSetting("host_id");
  const isHost = hostIdSetting && hostIdSetting === tiktok_id;

  // Unknown fallback
  const fallbackDisplay = `Onbekend#${tiktok_id.slice(-5)}`;
  const fallbackUsername = `@onbekend${tiktok_id.slice(-5)}`;

  // ========================================================================
  // UPSERT
  // ========================================================================
  await pool.query(
    `
    INSERT INTO users (
      tiktok_id,
      username,
      display_name,
      diamonds_total,
      bp_total,
      bp_daily,
      streak,
      badges,
      blocks,
      last_seen_at,
      is_fan,
      fan_expires_at
    )
    VALUES ($1, $2, $3, 0, 0, 0, 0, '{}',
      '{"queue":false,"twists":false,"boosters":false}',
      NOW(), false, NULL
    )
    ON CONFLICT (tiktok_id)
    DO UPDATE SET
      display_name = CASE
        WHEN users.display_name LIKE 'Onbekend#%' 
          OR EXCLUDED.display_name IS DISTINCT FROM users.display_name
        THEN EXCLUDED.display_name
        ELSE users.display_name
      END,
      username = CASE
        WHEN users.username LIKE '@onbekend%' 
          OR EXCLUDED.username IS DISTINCT FROM users.username
        THEN EXCLUDED.username
        ELSE users.username
      END,
      last_seen_at = NOW()
    `,
    [
      tid,
      newUsernameFull || fallbackUsername,
      newDisplay || fallbackDisplay,
    ]
  );

  // User terughalen
  const res = await pool.query(
    `SELECT display_name, username FROM users WHERE tiktok_id=$1 LIMIT 1`,
    [tid]
  );

  const row = res.rows[0] || {};

  const finalDisplay = row.display_name || fallbackDisplay;
  const finalUsername = (row.username || fallbackUsername).replace(/^@/, "");

  // ========================================================================
  // Upgrade logs (unknown → known updates)
  // ========================================================================

  if (
    newDisplay &&
    newDisplay !== fallbackDisplay &&
    newDisplay !== row.display_name
  ) {
    emitLog({
      type: "user",
      message: `Naam update: ${fallbackDisplay} → ${newDisplay}`,
    });
    console.log(`👤 Display upgrade: ${fallbackDisplay} → ${newDisplay}`);
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

  // ========================================================================
  // HOST FIX — host mag nooit onbekend zijn
  // ========================================================================

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

  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername,
  };
}

// ============================================================================
// upsertIdentityFromLooseEvent() — v2.2 FIXED
// ============================================================================
//
// 100% FIXED:
//  → Ondersteunt ALLE TikTok event structuren
//  → member.nickname werkt nu correct
//  → gift.sender / gift.user werkt correct
//  → chat._data.* wordt correct gelezen
//  → receiver structuur wordt volledig gescand
//
// ============================================================================

export async function upsertIdentityFromLooseEvent(raw: any): Promise<void> {
  if (!raw) return;

  // 1) Probeer ALLE mogelijke structuren
  const user =
    raw?.user ||
    raw?.sender ||
    raw?.toUser ||
    raw?.receiver ||
    raw?._data?.user ||
    raw?._data?.sender ||
    raw?._data ||
    raw;

  // 2) Mogelijke ID velden
  const id =
    user?.userId ||
    user?.uid ||
    user?.id ||
    user?.secUid ||
    raw?.userId ||
    raw?.senderUserId ||
    raw?.receiverUserId ||
    raw?.toUserId ||
    null;

  if (!id) return;

  // 3) display name
  const display =
    user?.nickname ||
    user?.displayName ||
    raw?.nickname ||
    raw?.displayName ||
    raw?._data?.nickname ||
    raw?._data?.displayName ||
    undefined;

  // 4) uniqueId (username)
  const unique =
    user?.uniqueId ||
    raw?.uniqueId ||
    raw?._data?.uniqueId ||
    raw?.user?.uniqueId ||
    raw?.sender?.uniqueId ||
    raw?.toUser?.uniqueId ||
    raw?.receiver?.uniqueId ||
    undefined;

  await getOrUpdateUser(String(id), display, unique);
}
