// src/engines/2-user-engine.ts
// USER ENGINE — versie 0.7.0
//
// Doelen:
//  - Onbekend minimaliseren
//  - Altijd juiste username & display_name opslaan
//  - Gebruikers upgraden wanneer betere data verschijnt
//  - Ondersteuning voor ALLE event formats van TikTok Live
//  - last_seen_at bijhouden (handig voor statistieken)
//  - Consistent met 3-gift-engine + 1-connection identity updaters
//
// Gebruikte kolommen:
//  - tiktok_id (TEXT)
//  - display_name (TEXT)
//  - username (TEXT) @cleaned
//  - last_seen_at (TIMESTAMP)
//  - diamonds_total, bp_total (bestaan al in jouw DB)

import pool from "../db";

// ─────────────────────────────────────────
// Helper — normalise usernames
// ─────────────────────────────────────────
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const clean =
    uid?.toString().trim().replace(/^@+/, "") ||
    fallback?.toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, "") ||
    "";

  if (!clean) return "";

  return clean.startsWith("@") ? clean : "@" + clean;
}

// ─────────────────────────────────────────
// Helper — clean & validate display name
// ─────────────────────────────────────────
function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}

// ─────────────────────────────────────────
// MAIN: getOrUpdateUser
// - altijd eerste functie voor gifts
// - upgrade wanneer nodig
// - heartbeat last_seen_at
// ─────────────────────────────────────────
export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id) {
    return {
      id: "??",
      display_name: "Onbekend",
      username: "onbekend",
    };
  }

  const tid = BigInt(tiktok_id);

  // 1) Load existing
  const found = await pool.query(
    `
    SELECT display_name, username
    FROM users
    WHERE tiktok_id = $1
    LIMIT 1
    `,
    [tid]
  );

  // 2) Determine new data
  const newDisplay = cleanDisplay(nickname);
  const newUsernameFull = normalizeHandle(uniqueId, nickname);
  const newUsernameClean = newUsernameFull.replace(/^@+/, "");

  // 3) If exists → maybe upgrade
  if (found.rows[0]) {
    const { display_name, username } = found.rows[0];

    const wasUnknown =
      (display_name || "").startsWith("Onbekend#") ||
      (username || "").toLowerCase().startsWith("@onbekend");

    const needsUpgrade =
      wasUnknown ||
      (newDisplay && newDisplay !== display_name) ||
      (newUsernameClean && newUsernameClean !== username.replace(/^@/, ""));

    if (needsUpgrade) {
      await pool.query(
        `
        UPDATE users
           SET display_name = $1,
               username = $2,
               last_seen_at = NOW()
         WHERE tiktok_id = $3
        `,
        [
          newDisplay || display_name || `Onbekend#${tiktok_id.slice(-5)}`,
          newUsernameFull || username,
          tid,
        ]
      );

      return {
        id: tiktok_id,
        display_name:
          newDisplay || display_name || `Onbekend#${tiktok_id.slice(-5)}`,
        username: newUsernameFull.replace(/^@+/, ""),
      };
    }

    // No upgrade, but heartbeat
    await pool.query(
      `UPDATE users SET last_seen_at = NOW() WHERE tiktok_id = $1`,
      [tid]
    );

    return {
      id: tiktok_id,
      display_name: display_name || `Onbekend#${tiktok_id.slice(-5)}`,
      username: (username || "@onbekend").replace(/^@+/, ""),
    };
  }

  // 4) New user → insert
  const finalDisplay = newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsernameFull || `@onbekend${tiktok_id.slice(-5)}`;

  await pool.query(
    `
    INSERT INTO users (tiktok_id, display_name, username, diamonds_total, bp_total, last_seen_at)
    VALUES ($1,$2,$3,0,0,NOW())
    ON CONFLICT (tiktok_id) DO NOTHING
    `,
    [tid, finalDisplay, finalUsername]
  );

  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername.replace(/^@+/, ""),
  };
}

// ─────────────────────────────────────────
// IDENTITY AUTO-UPSERT
//   Wordt aangeroepen door 1-connection.ts
//   Uit ALLE TikTok events
// ─────────────────────────────────────────

export async function upsertIdentityFromLooseEvent(loose: any): Promise<void> {
  if (!loose) return;

  const user =
    loose?.user ||
    loose?.sender ||
    loose?.toUser ||
    loose?.receiver ||
    loose;

  // Extract id
  const id =
    user?.userId ||
    user?.id ||
    user?.uid ||
    user?.secUid ||
    null;

  if (!id) return;

  // Extract display
  const display: string | undefined =
    user?.nickname || user?.displayName || undefined;

  // Extract username
  const unique: string | undefined =
    user?.uniqueId || user?.unique_id || undefined;

  await getOrUpdateUser(String(id), display, unique);
}
