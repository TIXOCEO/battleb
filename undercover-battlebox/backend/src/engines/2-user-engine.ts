import pool from "../db";

/**
 * Kern-API om user te vinden/aan te maken en te upgraden.
 * - Maakt UNKNOWN placeholder als we echt niets weten (Onbekend#xxxxx)
 * - Upgradet zodra er een echte nickname/uniqueId binnenkomt
 * - Zet last_seen_at bij elke call
 */
export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id || tiktok_id === "??") {
    return { id: "??", display_name: "Onbekend", username: "onbekend" };
  }

  const id = BigInt(tiktok_id);

  // Huidige staat ophalen
  const existing = await pool.query(
    "SELECT display_name, username FROM users WHERE tiktok_id = $1 LIMIT 1",
    [id]
  );

  // Helpers
  const cleanName = (name?: string | null) => {
    const v = typeof name === "string" ? name.trim() : "";
    return v && v.toLowerCase() !== "onbekend" ? v : null;
  };

  const normalizeHandle = (uid?: string | null, fallbackName?: string | null) => {
    const base =
      (uid || "")
        .toString()
        .trim()
        .replace(/^@+/, "") ||
      (fallbackName || "")
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "") ||
      `onbekend${tiktok_id.slice(-5)}`;
    return base.startsWith("@") ? base : `@${base}`;
  };

  const newDisplay = cleanName(nickname);
  const newUsernameFull = normalizeHandle(uniqueId, nickname);
  const newUsernameClean = newUsernameFull.replace(/^@+/, "");

  // Bestond al?
  if (existing.rows[0]) {
    const { display_name, username } = existing.rows[0] as {
      display_name: string;
      username: string;
    };

    // Upgrade criteria: als we een Unknown stap kunnen verbeteren
    const unknownLike =
      (display_name || "").startsWith("Onbekend#") ||
      (username || "").toLowerCase().startsWith("@onbekend");

    const needUpgrade =
      unknownLike || (!!newDisplay && newDisplay !== display_name);

    if (needUpgrade && newDisplay) {
      await pool.query(
        `
        UPDATE users
           SET display_name   = $1,
               username       = $2,
               last_seen_at   = NOW()
         WHERE tiktok_id     = $3
        `,
        [newDisplay, newUsernameFull, id]
      );
      return {
        id: tiktok_id,
        display_name: newDisplay,
        username: newUsernameClean,
      };
    } else {
      // Geen upgrade maar wel heartbeat
      await pool.query(
        `UPDATE users SET last_seen_at = NOW() WHERE tiktok_id = $1`,
        [id]
      );
      return {
        id: tiktok_id,
        display_name: display_name || `Onbekend#${tiktok_id.slice(-5)}`,
        username: (username || "@onbekend").replace(/^@+/, ""),
      };
    }
  }

  // Nieuw record
  const finalDisplay = newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsernameFull;

  await pool.query(
    `
    INSERT INTO users (tiktok_id, display_name, username, diamonds_total, bp_total, last_seen_at)
    VALUES ($1,$2,$3,0,0, NOW())
    ON CONFLICT (tiktok_id) DO NOTHING
    `,
    [id, finalDisplay, finalUsername]
  );

  return {
    id: tiktok_id,
    display_name: finalDisplay,
    username: finalUsername.replace(/^@+/, ""),
  };
}

/**
 * Probeer zoveel mogelijk uit willekeurige event payloads te halen
 * en de gebruiker te updaten/aan te maken. (Gebruikt door 1-connection.)
 *
 * Ondersteunt o.a. vormen:
 * - { userId, nickname, uniqueId }
 * - { user: { userId, nickname, uniqueId } }
 * - { sender: { userId, nickname, uniqueId } }
 * - { toUser / receiver: { userId, nickname, uniqueId } }
 */
export async function upsertIdentityFromLooseEvent(loose: any): Promise<void> {
  if (!loose) return;

  const user =
    loose?.user ||
    loose?.sender ||
    loose?.toUser ||
    loose?.receiver ||
    loose;

  const uid =
    (user?.userId ?? user?.id ?? user?.uid ?? user?.secUid ?? null) &&
    String(user?.userId ?? user?.id ?? user?.uid);

  const nickname: string | undefined =
    user?.nickname ?? user?.displayName ?? undefined;

  const uniqueId: string | undefined = user?.uniqueId ?? user?.unique_id ?? undefined;

  if (!uid) return;

  // Laat getOrUpdate het werk doen + heartbeat
  await getOrUpdateUser(uid, nickname, uniqueId);
}
