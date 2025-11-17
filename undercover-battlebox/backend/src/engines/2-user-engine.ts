// ============================================================================
// 2-user-engine.ts — USER ENGINE v3.3 (STRICT TIKTOK-ONLY, CLEAN, SAFE)
// ============================================================================
//
// ✔ Admin kan GEEN users aanmaken
// ✔ TikTok events zijn de enige bron voor nieuwe users
// ✔ Nooit duplicate inserts door veilige UPSERT-logica
// ✔ Username lowercase zonder '@'
// ✔ display_name altijd schoon
// ✔ last_seen_at altijd bijgewerkt
// ✔ Veilig bij slechte data van TikTok
// ============================================================================

import pool from "../db";

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CORE FUNCTION — TikTok-only UPSERT (admin maakt nooit users!)
// ---------------------------------------------------------------------------

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

  const newDisplay = cleanDisplay(nickname);
  const newUsername = normalizeHandle(uniqueId, nickname);

  // 1) Bestaat user al?
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
    // 2) UPDATE bestaande user indien betere data binnenkomt
    const { display_name: oldDisplay, username: oldUser } = existing.rows[0];

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
        `UPDATE users SET last_seen_at = NOW() WHERE tiktok_id=$1`,
        [tid]
      );
    }

    return {
      id: tiktok_id,
      display_name:
        newDisplay || oldDisplay || `Onbekend#${tiktok_id.slice(-5)}`,
      username:
        newUsername || oldUser || `onbekend${tiktok_id.slice(-5)}`,
    };
  }

  // 3) NIEUWE USER — alleen toegestaan via TikTok event
  const finalDisplay = newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsername || `onbekend${tiktok_id.slice(-5)}`;

  await pool.query(
    `
    INSERT INTO users (
      tiktok_id, display_name, username,
      diamonds_total, bp_total, last_seen_at,
      is_fan, fan_expires_at, is_vip
    )
    VALUES ($1,$2,$3,0,0,NOW(),false,NULL,false)
  `,
    [tid, finalDisplay, finalUsername]
  );

  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername,
  };
}

// ---------------------------------------------------------------------------
// AUTO-UPSERT vanuit TikTok events
// ---------------------------------------------------------------------------

export async function upsertIdentityFromLooseEvent(loose: any): Promise<void> {
  if (!loose) return;

  const u =
    loose?.user ||
    loose?.sender ||
    loose?.toUser ||
    loose?.receiver ||
    loose;

  const id =
    u?.userId ||
    u?.id ||
    u?.uid ||
    u?.secUid ||
    null;

  if (!id) return;

  const display = u?.nickname || u?.displayName || undefined;
  const unique = u?.uniqueId || u?.unique_id || undefined;

  await getOrUpdateUser(String(id), display, unique);
}
