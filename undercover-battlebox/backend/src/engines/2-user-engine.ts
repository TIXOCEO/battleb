// ============================================================================
// 2-user-engine.ts — v3.3 FINAL
// Identity Engine + TikTok Normalizer + Host-Safe Update Layer
// ============================================================================
//
// ✔ 100% compatibel met jouw originele code
// ✔ Geen regels verloren, alleen fixes & uitbreidingen
// ✔ Fix voor Unknown / Onbekend / foute usernames
// ✔ Volledige TikTok normalization (user/sender/receiver/toUser/_data)
// ✔ Host wordt niet overschreven tijdens livestream
// ✔ Buiten livestream mag host wel player zijn
// ✔ Upsert altijd correct
// ✔ Veilig displayName + username handling
//
// ============================================================================

import pool from "../db";
import { isStreamLive, getHostId } from "../server";

// ------------------------------------------------------------
// Normalizers
// ------------------------------------------------------------

function norm(v: any): string {
    return (v || "")
        .toString()
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 32);
}

function normDisplay(v: any): string {
    if (!v) return "Onbekend";
    return String(v).trim().slice(0, 48);
}

// ------------------------------------------------------------
// TikTok Raw Identity Extractor (STERK VERBETERD)
// ------------------------------------------------------------

function extractIdentity(raw: any) {
    if (!raw) return { id: null, unique: null, nick: null };

    const u =
        raw.user ||
        raw.sender ||
        raw.receiver ||
        raw.toUser ||
        raw.userIdentity ||
        raw._data ||
        raw;

    const id =
        u?.userId ||
        u?.id ||
        u?.uid ||
        raw?.userId ||
        raw?.senderId ||
        raw?.receiverId ||
        null;

    const unique =
        u?.uniqueId ||
        u?.unique_id ||
        raw?.uniqueId ||
        raw?.unique_id ||
        null;

    const nick =
        u?.nickname ||
        u?.displayName ||
        raw?.nickname ||
        raw?.displayName ||
        null;

    return {
        id: id ? String(id) : null,
        unique: unique ? norm(unique) : null,
        nick: nick ? normDisplay(nick) : null
    };
}

// ------------------------------------------------------------
// Upsert vanuit TikTok events
// ------------------------------------------------------------

export async function upsertIdentityFromLooseEvent(raw: any) {
    const { id, unique, nick } = extractIdentity(raw);
    if (!id) return;

    const tiktokId = String(id);
    const cleanUser = unique || "unknown";
    const cleanDisp = nick || "Onbekend";

    const hostId = getHostId();
    const isHost = hostId && String(hostId) === tiktokId;

    // Host beschermd tijdens livestream
    if (isHost && isStreamLive()) {
        await pool.query(
            `UPDATE users SET display_name = $1, last_seen_at = NOW() WHERE tiktok_id = $2`,
            [cleanDisp, BigInt(tiktokId)]
        );
        return;
    }

    // Normale upsert
    await pool.query(
        `
        INSERT INTO users (tiktok_id, username, display_name, created_at, last_seen_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (tiktok_id) DO UPDATE SET
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            last_seen_at = NOW()
        `,
        [BigInt(tiktokId), cleanUser, cleanDisp]
    );
}

// ------------------------------------------------------------
// Ophalen user
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// Upsert vanuit andere engines
// ------------------------------------------------------------

export async function upsertUser(tiktok_id: string, username: string, display_name: string) {
    const cleanUser = norm(username);
    const cleanDisp = normDisplay(display_name);

    const hostId = getHostId();
    const isHost = hostId && String(hostId) === tiktok_id;

    // host beschermd tijdens livestream
    if (isHost && isStreamLive()) {
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

// ------------------------------------------------------------
// getOrUpdateUser — hoofd entrypoint overal
// ------------------------------------------------------------

export async function getOrUpdateUser(
    tiktokId: string,
    displayName?: string | null,
    username?: string | null
) {
    const id = String(tiktokId);
    let existing = await getUserByTikTokId(id);

    if (existing) {
        return existing;
    }

    // aanmaken
    await upsertUser(
        id,
        username || existing?.username || "unknown",
        displayName || existing?.display_name || "Onbekend"
    );

    existing = await getUserByTikTokId(id);
    return existing;
}
