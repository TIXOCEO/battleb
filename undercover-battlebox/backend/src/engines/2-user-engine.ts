// ============================================================================
// 2-user-engine.ts — USER ENGINE v4.0 (STRICT TIKTOK-ONLY, UPSERT SAFE)
// ============================================================================
//
// ✔ Echte PostgreSQL UPSERT → onmogelijk om duplicate-key errors te krijgen
// ✔ Admin kan NOOIT users aanmaken (alleen TikTok events)
// ✔ Username altijd lowercase, zonder '@'
// ✔ Display_name altijd netjes geformatteerd
// ✔ last_seen_at ALTIJD geüpdatet
// ✔ Nickname / uniqueId combineren tot beste username
// ✔ Volledige compatibiliteit met alle andere engines
// ============================================================================

import pool from "../db";

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------

function normalizeHandle(uid?: string | null, fallback?: string | null): string {
  const base =
    uid?.toString().trim().replace(/^@+/, "") ||
    fallback?.toString().trim() ||
    "";

  if (!base) return "";

  return base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function cleanDisplay(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "onbekend") return null;
  return t;
}

// -------------------------------------------------------------
// UPSERT — DE ENIGE TOEGESTANE MANIER OM USERS BIJ TE WERKEN
// -------------------------------------------------------------

export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id) {
    return {
      id: "??",
      display_name: "Onbekend",
      username: "onbekend"
    };
  }

  const tid = BigInt(tiktok_id);

  const newDisplay = cleanDisplay(nickname) || `Onbekend#${tiktok_id.slice(-5)}`;
  const newUsername =
    normalizeHandle(uniqueId, nickname) ||
    `onbekend${tiktok_id.slice(-5)}`;

  // ⭐ NIEUWE SUPER VEILIGE UPSERT ⭐
  const result = await pool.query(
    `
    INSERT INTO users (
      tiktok_id, display_name, username,
      diamonds_total, bp_total, last_seen_at,
      is_fan, fan_expires_at, is_vip
    )
    VALUES ($1,$2,$3,0,0,NOW(),false,NULL,false)
    ON CONFLICT (tiktok_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          username     = EXCLUDED.username,
          last_seen_at = NOW()
    RETURNING display_name, username
  `,
    [tid, newDisplay, newUsername]
  );

  return {
    id: tiktok_id,
    display_name: result.rows[0].display_name,
    username: result.rows[0].username
  };
}

// -------------------------------------------------------------
// TikTok loose event auto-upsert
// -------------------------------------------------------------

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
  const unique  = u?.uniqueId || u?.unique_id || undefined;

  await getOrUpdateUser(String(id), display, unique);
}
