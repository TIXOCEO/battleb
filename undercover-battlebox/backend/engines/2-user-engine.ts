// engines/2-user-engine.ts
import pool from '../db';

export async function getOrUpdateUser(
  tiktok_id: string,
  nickname?: string,
  uniqueId?: string
): Promise<{ id: string; display_name: string; username: string }> {
  if (!tiktok_id || tiktok_id === '??') {
    return { id: '??', display_name: 'Onbekend', username: 'onbekend' };
  }

  const id = BigInt(tiktok_id);

  let { rows } = await pool.query(
    'SELECT display_name, username FROM users WHERE tiktok_id = $1',
    [id]
  );

  if (rows[0]) {
    const currentName = rows[0].display_name;
    const currentUsername = rows[0].username;

    if (nickname && nickname !== 'Onbekend' && nickname !== currentName) {
      const cleanUsername = (uniqueId || nickname.toLowerCase().replace(/[^a-z0-9_]/g, '')).trim();
      const finalUsername = cleanUsername.startsWith('@') ? cleanUsername : '@' + cleanUsername;

      await pool.query(
        `UPDATE users SET display_name = $1, username = $2 WHERE tiktok_id = $3`,
        [nickname, finalUsername, id]
      );

      console.log(`[UPDATE] ${currentName} → ${nickname} (@${cleanUsername})`);
      return { id: tiktok_id, display_name: nickname, username: cleanUsername };
    }

    const cleanUsername = currentUsername.startsWith('@') ? currentUsername.slice(1) : currentUsername;
    return { id: tiktok_id, display_name: currentName, username: cleanUsername };
  }

  const display_name = nickname && nickname !== 'Onbekend' ? nickname : `Onbekend#${tiktok_id.slice(-5)}`;
  const rawUsername = (uniqueId || display_name.toLowerCase().replace(/[^a-z0-9_]/g, '')).trim();
  const finalUsername = rawUsername.startsWith('@') ? rawUsername : '@' + rawUsername;

  await pool.query(
    `INSERT INTO users (tiktok_id, display_name, username, diamonds_total, bp_total)
     VALUES ($1, $2, $3, 0, 0)
     ON CONFLICT (tiktok_id) DO NOTHING`,
    [id, display_name, finalUsername]
  );

  console.log(`[NIEUW] ${display_name} (@${finalUsername.slice(1)})`);

  const { rows: finalRows } = await pool.query(
    'SELECT display_name, username FROM users WHERE tiktok_id = $1',
    [id]
  );

  const user = finalRows[0];
  const cleanUsername = user.username.startsWith('@') ? user.username.slice(1) : user.username;

  return { id: tiktok_id, display_name: user.display_name, username: cleanUsername };
}
