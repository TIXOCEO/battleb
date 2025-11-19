// ============================================================================
// 2-user-engine.ts — v3.0 (IDENTITY ENGINE + HOST-SAFE)
// Undercover BattleBox — Identity Normalization Layer
// ============================================================================
//
// ENHANCEMENTS v3.0:
//  ✔ Username normalization naar BattleBox-standaard
//  ✔ Upsert werkt 100% met host, cohost en spelers
//  ✔ Host wordt NIET als player behandeld tijdens livestream (server.ts flag)
//  ✔ Buiten livestream kan host wel gewoon player worden
//  ✔ Displayname fallback verbeterd
//  ✔ Beschermt tegen corrupted TikTok events
//
// ============================================================================

import pool from "../db";
import { isStreamLive, getHostId } from "../server"; // <-- toegevoegd

// Normaliseer usernames in consistente BattleBox-stijl
function norm(v: any): string {
    return (v || "")
        .toString()
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 32);
}

// Zet displayname altijd veilig
function normDisplay(v: any): string {
    if (!v) return "Onbekend";
    return String(v).trim().slice(0, 48);
}

interface LooseIdentity {
    userId?: string | number;
    uniqueId?: string;
    nickname?: string;
    displayName?: string;
}

// ============================================================================
// Upsert Identity — wordt door heel BattleBox gebruikt
// ============================================================================

export async function upsertIdentityFromLooseEvent(raw: LooseIdentity | any) {
    if (!raw) return;

    // Breedste mogelijke user extractie
    const u =
        raw.user ||
        raw.sender ||
        raw.receiver ||
        raw.toUser ||
        raw.userIdentity ||
        raw;

    const userId =
        u?.userId ||
        u?.id ||
        u?.uid ||
        raw?.userId ||
        raw?.senderId ||
        raw?.receiverId ||
        null;

    if (!userId) return;

    const tiktokId = String(userId);

    const username = norm(
        u?.uniqueId ||
        u?.unique_id ||
        raw?.uniqueId ||
        raw?.unique_id
    );

    const displayName = normDisplay(
        u?.nickname ||
        u?.displayName ||
        raw?.nickname ||
        raw?.displayName
    );

    // Host mag NIET overschreven worden tijdens livestream
    const hostId = getHostId();

    const isHost = hostId && String(hostId) === tiktokId;

    if (isHost && isStreamLive()) {
        // Host is live; alleen display_name mag zacht bijgewerkt worden
        await pool.query(
            `UPDATE users SET display_name = $1 WHERE tiktok_id = $2`,
            [displayName, BigInt(tiktokId)]
        );
        return;
    }

    // === Upsert user (gewone speler, cohost of host buiten livestream) ===

    await pool.query(
        `
        INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (tiktok_id) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            last_seen_at = NOW()
        `,
        [BigInt(tiktokId), username, displayName]
    );
}

// ============================================================================
// Ophalen user (vaak gebruikt in game-engine / gift-engine)
// ============================================================================

export async function getUserByTikTokId(id: string) {
    const { rows } = await pool.query(
        `SELECT * FROM users WHERE tiktok_id = $1`,
        [BigInt(id)]
    );
    return rows[0] || null;
}

export async function getUserByUsername(username: string) {
    const clean = norm(username);
    const { rows } = await pool.query(
        `SELECT * FROM users WHERE username = $1`,
        [clean]
    );
    return rows[0] || null;
}

// ============================================================================
// Upsert vanuit gift-engine of battle-engine
// ============================================================================

export async function upsertUser(tiktok_id: string, username: string, display_name: string) {
    const cleanUser = norm(username);
    const cleanDisp = normDisplay(display_name);

    const hostId = getHostId();

    if (hostId && String(hostId) === tiktok_id && isStreamLive()) {
        // Host live → username NIET wijzigen
        await pool.query(
            `UPDATE users SET display_name=$1, last_seen_at=NOW() WHERE tiktok_id=$2`,
            [cleanDisp, BigInt(tiktok_id)]
        );
        return;
    }

    await pool.query(
        `
        INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT(tiktok_id) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            last_seen_at = NOW()
        `,
        [BigInt(tiktok_id), cleanUser, cleanDisp]
    );
}

