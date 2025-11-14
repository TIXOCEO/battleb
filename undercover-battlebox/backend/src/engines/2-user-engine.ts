// src/engines/2-user-engine.ts
// USER ENGINE — versie 0.7.1 FINAL
//
// Doelen:
//  - Onbekend minimaliseren
//  - Upgrades wanneer betere data binnenkomt
//  - last_seen_at altijd bijwerken
//  - Consistent met gift-engine + identity updates
//
// Gebruikte kolommen (users):
// tiktok_id (bigint), display_name, username, last_seen_at,
// diamonds_total, bp_total, is_fan, fan_expires_at

import pool from "../db";

// Normalise username
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const clean =
    uid?.toString().trim().replace(/^@+/, "") ||
    fallback?.toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, "") ||
    "";

  if (!clean) return "";
  return clean.startsWith("@") ? clean : "@" + clean;
}

// Clean display
function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}

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

  // Load existing
  const found = await pool.query(
    `
    SELECT display_name, username
    FROM users
    WHERE tiktok_id = $1
    LIMIT 1
    `,
    [tid]
  );

  const newDisplay = cleanDisplay(nickname);
  const newUsernameFull = normalizeHandle(uniqueId, nickname);
  const newUsernameClean = newUsernameFull.replace(/^@+/, "");

  // Existing → upgrade if needed
  if (found.rows[0]) {
    const { display_name, username } = found.rows[0];

    const wasUnknown =
      (display_name || "").startsWith("Onbekend#") ||
      (username || "").toLowerCase().startsWith("@onbekend");

    const needsUpgrade =
      wasUnknown ||
      (newDisplay && newDisplay !== display_name) ||
      (newUsernameClean &&
        newUsernameClean !== username.replace(/^@/, ""));

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
    } else {
      await pool.query(
        `UPDATE users SET last_seen_at = NOW() WHERE tiktok_id = $1`,
        [tid]
      );
    }

    return {
      id: tiktok_id,
      display_name:
        newDisplay || display_name || `Onbekend#${tiktok_id.slice(-5)}`,
      username: (newUsernameFull || username || "@onbekend").replace(
        /^@+/,
        ""
      ),
    };
  }

  // NEW USER
  const finalDisplay = newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsernameFull || `@onbekend${tiktok_id.slice(-5)}`;

  await pool.query(
    `
    INSERT INTO users (
      tiktok_id, display_name, username,
      diamonds_total, bp_total, last_seen_at,
      is_fan, fan_expires_at
    )
    VALUES ($1,$2,$3,0,0,NOW(),false,NULL)
    `,
    [tid, finalDisplay, finalUsername]
  );

  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername.replace(/^@+/, ""),
  };
}


// AUTO-UPSERT from any TikTok event
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
    user?.nickname || user?.displayName || undefined;

  const unique =
    user?.uniqueId || user?.unique_id || undefined;

  await getOrUpdateUser(String(id), display, unique);
}
