// src/engines/2-user-engine.ts
// USER ENGINE — STABLE VERSION 1.0
//
// Doelen:
//  - Nooit meer duplicate key errors
//  - Upgrades wanneer betere data binnenkomt
//  - last_seen_at altijd bijwerken
//  - Consistent met gift-engine + identity updates
//
// Gebruikte kolommen (users):
// tiktok_id (bigint), display_name, username, last_seen_at,
// diamonds_total, bp_total, is_fan, fan_expires_at

import pool from "../db";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// Normaliseer username, zet nooit @ ervoor in database, maar wel in memory
function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const clean =
    uid?.toString().trim().replace(/^@+/, "") ||
    fallback?.toString().trim().toLowerCase().replace(/[^a-z0-9_]/g, "") ||
    "";

  if (!clean) return "";
  return clean.toLowerCase();
}

function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}

// ─────────────────────────────────────────────
// CORE FUNCTION — FIXED SAFE UPSERT
// ─────────────────────────────────────────────

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

  // Nieuwe user-waarde candidates
  const newDisplay = cleanDisplay(nickname);
  const newUsername = normalizeHandle(uniqueId, nickname);

  // ─────────────────────────────────────────────
  // 1) BESTAAT USER?
  // ─────────────────────────────────────────────
  const existing = await pool.query(
    `
    SELECT display_name, username
    FROM users
    WHERE tiktok_id = $1
    LIMIT 1
    `,
    [tid]
  );

  if (existing.rows.length > 0) {
    // ─────────────────────────────────────────────
    // 2) UPDATE bestaande user
    // ─────────────────────────────────────────────
    const { display_name, username } = existing.rows[0];

    const oldUser = username?.replace(/^@+/, "") || "";
    const oldDisplay = display_name || null;

    const needsUpgrade =
      (newDisplay && newDisplay !== oldDisplay) ||
      (newUsername && newUsername !== oldUser);

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
          newDisplay || oldDisplay || `Onbekend#${tiktok_id.slice(-5)}`,
          newUsername || oldUser || `onbekend${tiktok_id.slice(-5)}`,
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
      display_name: newDisplay || oldDisplay || `Onbekend#${tiktok_id.slice(-5)}`,
      username: (newUsername || oldUser || `onbekend${tiktok_id.slice(-5)}`).replace(/^@+/, ""),
    };
  }

  // ─────────────────────────────────────────────
  // 3) NIEUWE USER — altijd 1 veilige INSERT
  //    Nooit een duplicate error!
  // ─────────────────────────────────────────────

  const finalDisplay = newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsername || `onbekend${tiktok_id.slice(-5)}`;

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
    username: finalUsername,
  };
}

// ─────────────────────────────────────────────
// AUTO-UPSERT vanuit elk TikTok event
// ─────────────────────────────────────────────

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
