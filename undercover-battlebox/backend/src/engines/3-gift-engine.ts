// ============================================================================
// 3-gift-engine.ts — v8.0 FINAL (HOST DIAMONDS + FAN SYSTEM + LOG LABELS)
// Undercover BattleBox — Gift, Twist, Arena & Host/Fan processing
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser, getUserByTikTokId } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// INTERNAL HOST STATE
// ============================================================================

let HOST_ID: string | null = null;
let HOST_USERNAME: string = "";

export async function refreshHostUsername() {
    HOST_ID = await getSetting("host_id");
    const u = await getSetting("host_username");

    HOST_USERNAME = (u || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();

    console.log(`🔄 HOST REFRESH → id=${HOST_ID} @${HOST_USERNAME}`);
}

export async function initDynamicHost() {
    await refreshHostUsername();
}

// ============================================================================
// HELPERS
// ============================================================================

const dedupe = new Set<string>();
setInterval(() => dedupe.clear(), 25000);

function norm(v: any): string {
    return (v || "")
        .toString()
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/gi, "")
        .slice(0, 30);
}

function now() {
    return Date.now();
}

// Label system — adds [HOST] or [FAN]
function formatDisplay(u: any) {
    if (!u) return "Onbekend";

    const isHost = HOST_ID && String(u.tiktok_id) === HOST_ID;
    const isFan = u.is_fan;

    if (isHost) return `${u.display_name} [HOST]`;
    if (isFan) return `${u.display_name} [FAN]`;
    return u.display_name;
}

function logUserChange(id: string, label: string, user: any) {
    const msg = `${label} update: ${id} → ${user.display_name} (@${user.username})`;
    console.log(`👤 ${msg}`);
}

// ============================================================================
// CALC DIAMONDS (TikTok repeat-gift logic)
// ============================================================================

function calcDiamonds(evt: any): number {
    const raw = Number(evt.diamondCount || evt.diamond || 0);
    if (raw <= 0) return 0;

    const repeat = Number(evt.repeatCount || 1);
    const final = !!evt.repeatEnd;
    const type = Number(evt.giftType || 0);

    // type 1 = streak gift
    if (type === 1) return final ? raw * repeat : 0;
    return raw;
}

// ============================================================================
// FAN EXPIRE CHECK
// ============================================================================

async function cleanupFan(id: string) {
    const r = await pool.query(
        `SELECT is_fan, fan_expires_at FROM users WHERE tiktok_id=$1`,
        [BigInt(id)]
    );

    if (!r.rows[0]) return false;

    const { is_fan, fan_expires_at } = r.rows[0];

    if (!is_fan || !fan_expires_at) return false;

    if (new Date(fan_expires_at).getTime() <= now()) {
        await pool.query(`
            UPDATE users
            SET is_fan=FALSE, fan_expires_at=NULL
            WHERE tiktok_id=$1
        `, [BigInt(id)]);
        return false;
    }

    return true;
}

// ============================================================================
// RESOLVE RECEIVER — HOST-SAFE
// ============================================================================

async function resolveReceiver(evt: any) {
    const hostId = HOST_ID;
    const hostUser = HOST_USERNAME;

    const eventId =
        evt.receiverUserId ||
        evt.toUserId ||
        evt.toUser?.userId ||
        evt.receiver?.userId ||
        null;

    const unique = evt.toUser?.uniqueId || evt.receiver?.uniqueId || null;
    const nick = evt.toUser?.nickname || evt.receiver?.nickname || null;

    const un = unique ? norm(unique) : null;
    const nn = nick ? norm(nick) : null;

    console.log(`🎯 resolveReceiver`, {
        eventId: eventId || "-",
        unique: un || "-",
        nick: nn || "-",
        hostId,
        hostUser
    });

    // ---- 1. Hard Id match
    if (hostId && eventId && String(eventId) === hostId) {
        const h = await getOrUpdateUser(hostId, nick || unique, unique);
        logUserChange(hostId, "HOST(id)", h);
        return { id: hostId, username: h.username, display_name: h.display_name, role: "host" };
    }

    // ---- 2. UniqueId match
    if (hostId && hostUser && un === hostUser) {
        const h = await getOrUpdateUser(hostId, nick || unique, unique);
        logUserChange(hostId, "HOST(unique)", h);
        return { id: hostId, username: h.username, display_name: h.display_name, role: "host" };
    }

    // ---- 3. Nickname fuzzy match
    if (hostId && hostUser && nn && nn.includes(hostUser)) {
        const h = await getOrUpdateUser(hostId, nick || unique, unique);
        logUserChange(hostId, "HOST(nick)", h);
        return { id: hostId, username: h.username, display_name: h.display_name, role: "host" };
    }

    // ---- 4. HeartMe gift with missing receiver → ALWAYS host
    if (evt.giftId === 5655 && hostId) {
        const h = await getOrUpdateUser(hostId, nick || unique, unique);
        logUserChange(hostId, "HOST(heartme)", h);
        return { id: hostId, username: h.username, display_name: h.display_name, role: "host" };
    }

    // ---- 5. Normal user
    if (eventId) {
        const u = await getOrUpdateUser(String(eventId), nick || null, unique || null);
        logUserChange(String(eventId), "RECEIVER", u);
        return { id: u.id, username: u.username, display_name: u.display_name, role: "speler" };
    }

    // ---- 6. EXTREME fallback
    if (hostId) {
        const h = await getOrUpdateUser(hostId, nick || unique, unique);
        logUserChange(hostId, "HOST(fallback)", h);
        return { id: hostId, username: h.username, display_name: h.display_name, role: "host" };
    }

    return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

async function processGift(evt: any, source: string) {
    console.log(`💠 Gift[${source}] giftId=${evt.giftId}`);

    // Dedup
    const key =
        evt.msgId ||
        evt.logId ||
        evt.eventId ||
        `${source}-${evt.giftId}-${evt.user?.userId}-${evt.timestamp}`;

    if (dedupe.has(key)) return;
    dedupe.add(key);

    // ----- SENDER -----
    const senderId =
        evt.user?.userId ||
        evt.sender?.userId ||
        evt.userId ||
        evt.senderUserId ||
        null;

    if (!senderId) {
        console.warn("⚠ Gift zonder sender → skip");
        return;
    }

    const sender = await getOrUpdateUser(
        String(senderId),
        evt.user?.nickname || evt.sender?.nickname,
        evt.user?.uniqueId || evt.sender?.uniqueId
    );

    // cleanup expired fan
    await cleanupFan(String(senderId));

    // TikTok gift streak
    const credited = calcDiamonds(evt);
    if (credited <= 0) {
        console.log("ℹ️ Gift streak not done");
        return;
    }

    // ----- RECEIVER -----
    const receiver = await resolveReceiver(evt);
    const isHost = receiver.role === "host";

    // ----- LOGGING -----
    const senderFmt = formatDisplay(sender);
    const receiverUser = await getUserByTikTokId(receiver.id);
    const receiverFmt = formatDisplay(receiverUser);

    console.log(`🎁 ${senderFmt} → ${receiverFmt} (${evt.giftName}) +${credited}💎`);

    // ----- Award diamonds to sender -----
    await addDiamonds(BigInt(senderId), credited, "total");
    await addDiamonds(BigInt(senderId), credited, "stream");
    await addDiamonds(BigInt(senderId), credited, "current_round");

    const bp = credited * 0.2;
    await addBP(BigInt(senderId), bp, "GIFT", sender.display_name);

    // ----- Arena score for receiver (NO HOST) -----
    const arena = getArena();
    const active = arena.status === "active" && now() <= arena.roundCutoff;
    const grace = arena.status === "grace" && now() <= arena.graceEnd;
    const inRound = active || grace;

    if (!isHost && receiver.id && inRound) {
        await safeAddArenaDiamonds(String(receiver.id), credited);
    }

    // ========================================================================
    // HOST RECEIVES DIAMONDS (NEW)
    // ========================================================================
    if (isHost && receiver.id) {
        await pool.query(`
            UPDATE users
            SET diamonds_total = diamonds_total + $1,
                diamonds_stream = diamonds_stream + $1,
                diamonds_current_round = diamonds_current_round + $1
            WHERE tiktok_id=$2
        `, [credited, BigInt(receiver.id)]);
    }

    // ========================================================================
    // FANCLUB (HeartMe: giftId = 5655)
    // ========================================================================
    if (isHost && evt.giftId === 5655) {
        const expires = new Date(now() + 24 * 3600 * 1000);

        await pool.query(`
            UPDATE users
            SET is_fan=TRUE, fan_expires_at=$1
            WHERE tiktok_id=$2
        `, [expires, BigInt(senderId)]);

        emitLog({
            type: "fan",
            message: `${sender.display_name} is nu [FAN] voor 24 uur ❤️`
        });
    }

    // ========================================================================
    // TWISTS
    // ========================================================================
    const giftId = Number(evt.giftId);
    const twistType: TwistType | null =
        (Object.keys(TWIST_MAP) as TwistType[]).find(
            t => TWIST_MAP[t].giftId === giftId
        ) || null;

    if (twistType) {
        await addTwistByGift(String(senderId), twistType);

        emitLog({
            type: "twist",
            message: `${senderFmt} activeerde twist: ${TWIST_MAP[twistType].giftName}`
        });
    }

    // ========================================================================
    // DATABASE LOG
    // ========================================================================
    const gameId = (io as any).currentGameId ?? null;

    await pool.query(`
        INSERT INTO gifts (
            giver_id, giver_username, giver_display_name,
            receiver_id, receiver_username, receiver_display_name,
            receiver_role, gift_name, diamonds, bp,
            game_id, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    `, [
        BigInt(senderId),
        sender.username,
        sender.display_name,

        receiver.id ? BigInt(receiver.id) : null,
        receiver.username,
        receiver.display_name,
        receiver.role,

        evt.giftName || "unknown",
        credited,
        bp,
        gameId
    ]);

    // ========================================================================
    // REALTIME LOG
    // ========================================================================
    emitLog({
        type: "gift",
        message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${credited}💎)`
    });
}

// ============================================================================
// INIT ENGINE
// ============================================================================

export function initGiftEngine(conn: any) {
    if (!conn || typeof conn.on !== "function") {
        console.log("⚠ initGiftEngine: no connection");
        return;
    }

    console.log("🎁 GiftEngine v8.0 LOADED");

    conn.on("gift", (d: any) => processGift(d, "gift"));

    conn.on("roomMessage", (d: any) => {
        if (d?.giftId || d?.diamondCount) processGift(d, "roomMessage");
    });

    conn.on("member", (d: any) => {
        if (d?.giftId || d?.diamondCount) processGift(d, "member");
    });

    conn.on("chat", (d: any) => {
        if (d?._data?.giftId || d?._data?.diamondCount) {
            processGift(d._data, "chat-hidden");
        }
    });
}

// ============================================================================
// END FILE
// ============================================================================

export default {
    initGiftEngine,
    refreshHostUsername,
    initDynamicHost
};
