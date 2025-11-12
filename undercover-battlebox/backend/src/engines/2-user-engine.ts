import pool from "../db";

export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id || tiktok_id === "??") {
    return { id: "??", display_name: "Onbekend", username: "onbekend" };
  }

  const id = BigInt(tiktok_id);

  // Probeer bestaande gebruiker te vinden
  const existing = await pool.query(
    "SELECT display_name, username FROM users WHERE tiktok_id = $1 LIMIT 1",
    [id]
  );

  // Functie om naam en username te schonen
  const cleanName = (name?: string) =>
    name && name !== "Onbekend" ? name.trim() : null;
  const cleanUsername = (uid?: string, name?: string) => {
    const base =
      uid ||
      name?.toLowerCase().replace(/[^a-z0-9_]/g, "") ||
      `onbekend${tiktok_id.slice(-5)}`;
    const normalized = base.startsWith("@") ? base : `@${base}`;
    return normalized;
  };

  const newDisplay = cleanName(nickname);
  const newUsername = cleanUsername(uniqueId, nickname);

  // === UPDATE bestaand record ===
  if (existing.rows[0]) {
    const { display_name, username } = existing.rows[0];

    // Als gebruiker Onbekend#... is en we nu echte data hebben → upgrade
    const needsUpgrade =
      display_name.startsWith("Onbekend#") ||
      username.startsWith("@onbekend") ||
      (newDisplay && newDisplay !== display_name);

    if (needsUpgrade && newDisplay) {
      await pool.query(
        `UPDATE users SET display_name = $1, username = $2 WHERE tiktok_id = $3`,
        [newDisplay, newUsername, id]
      );
      console.log(
        `[UPDATE] ${display_name} → ${newDisplay} (${newUsername})`
      );
      return { id: tiktok_id, display_name: newDisplay, username: newUsername.replace(/^@/, "") };
    }

    // Anders huidige data behouden
    return {
      id: tiktok_id,
      display_name,
      username: username.replace(/^@/, ""),
    };
  }

  // === NIEUWE gebruiker aanmaken ===
  const finalDisplay =
    newDisplay || `Onbekend#${tiktok_id.slice(-5)}`;
  const finalUsername = newUsername;

  await pool.query(
    `INSERT INTO users (tiktok_id, display_name, username, diamonds_total, bp_total)
     VALUES ($1,$2,$3,0,0)
     ON CONFLICT (tiktok_id) DO NOTHING`,
    [id, finalDisplay, finalUsername]
  );

  console.log(`[NIEUW] ${finalDisplay} (${finalUsername})`);

  return { id: tiktok_id, display_name: finalDisplay, username: finalUsername.replace(/^@/, "") };
}
