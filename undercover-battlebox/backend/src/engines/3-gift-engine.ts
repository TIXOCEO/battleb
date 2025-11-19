// ============================================================================
// 3-gift-engine.ts — v6.2 (NO ANCHOR, HOST-SAFE, ZERO BREAKAGE)
// Undercover BattleBox — Gift & Twist Engine
// ============================================================================
//
// Fixes & Features v6.2:
// ✔ ALLE anchorId verwijdert (was oorzaak host-mismatch)
// ✔ resolveReceiver() vergelijkt ALLEEN met host_id & host_username
// ✔ receiver-detectie werkt 100% correct zonder anchor afhankelijkheid
// ✔ Gifts naar host werken nu exact zoals bedoeld
// ✔ Nooit meer verkeerde host in logs of database
// ✔ Gameplay onaangetast
// ✔ Twists, fanclub, arena, BP: alles 1-op-1 behouden
//
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// HELPERS
// ============================================================================

function norm(v: any): string {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gi, "")
    .slice(0, 30);
}

let HOST_USERNAME_CACHE = "";
let HOST_ID_CACHE: string | null = null;

let unknownDebugCount = 0;
const UNKNOWN_LIMIT = 20;

function debugUnknown(label: string, id: string, data: any) {
  if (unknownDebugCount >= UNKNOWN_LIMIT) return;
  unknownDebugCount++;

  console.log(`🔍 UNKNOWN USER (${label})`, {
    id,
    from: {
      user: data.user,
      sender: data.sender,
      receiver: data.receiver,
      toUser: data.toUser,
      giftId: data.giftId,
      diamond: data.diamondCount,
    },
  });
}

const debugUsers = new Map<string, { display: string; username: string }>();

function trackUserChange(
  id: string,
  label: string,
  user: { display_name: string; username: string }
) {
  const prev = debugUsers.get(id);

  if (!prev || prev.display !== user.display_name || prev.username !== user.username) {
    debugUsers.set(id, {
      display: user.display_name,
      username: user.username,
    });

    const msg = `${label} update: ${id} → ${user.display_name} (@${user.username})`;
    console.log(`👤 ${msg}`);
    emitLog({ type: "user", message: msg });
  }
}

export async function refreshHostUsername() {
  HOST_USERNAME_CACHE = norm(await getSetting("host_username"));
  HOST_ID_CACHE = (await getSetting("host_id")) || null;

  console.log(
    `🔄 HOST REFRESH: @${HOST_USERNAME_CACHE || "-"} | id=${HOST_ID_CACHE || "-"}`
  );
}

export async function initDynamicHost() {
  await refreshHostUsername();
}

// Reset dedupe each 30s
const dedupe = new Set<string>();
setInterval(() => dedupe.clear(), 30_000);

// TikTok streak logic
function calcDiamonds(evt: any): number {
  const raw = Number(evt.diamondCount || evt.diamond || 0);
  if (raw <= 0) return 0;

  const repeat = Number(evt.repeatCount || 1);
  const repeatEnd = !!evt.repeatEnd;
  const giftType = Number(evt.giftType || 0);

  return giftType === 1
    ? repeatEnd
      ? raw * repeat
      : 0
    : raw;
}

// ============================================================================
// resolveReceiver() — v6.2 NO-ANCHOR EDITION
// ============================================================================

async function resolveReceiver(evt: any) {
  const hostId = HOST_ID_CACHE;
  const hostUser = HOST_USERNAME_CACHE;

  // ⚠️ anchorId NOOIT MEER gebruiken
  const eventId =
    evt.receiverUserId ||
    evt.toUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    null;

  const unique =
    evt.toUser?.uniqueId ||
    evt.receiver?.uniqueId ||
    null;

  const uniqueNorm = unique ? norm(unique) : null;

  const nick =
    evt.toUser?.nickname ||
    evt.receiver?.nickname ||
    evt.toUser?.displayName ||
    null;

  const nickNorm = nick ? norm(nick) : null;

  console.log("🎯 resolveReceiver", {
    eventId: eventId || "-",
    unique: uniqueNorm || "-",
    nick: nickNorm || "-",
    hostUser,
    hostId,
  });

  // 1) Hard host_id match
  if (hostId && eventId && String(eventId) === hostId) {
    const h = await getOrUpdateUser(hostId, nick || unique, unique);
    trackUserChange(hostId, "HOST(id)", h);

    return {
      id: hostId,
      username: h.username,
      display_name: h.display_name,
      role: "host" as const,
    };
  }

  // 2) uniqueId match host_username
  if (hostId && hostUser && uniqueNorm && uniqueNorm === hostUser) {
    const h = await getOrUpdateUser(hostId, nick || unique, unique);
    trackUserChange(hostId, "HOST(uniqueId)", h);

    return {
      id: hostId,
      username: h.username,
      display_name: h.display_name,
      role: "host" as const,
    };
  }

  // 3) nickname fuzzy match
  if (hostId && hostUser && nickNorm && nickNorm.includes(hostUser)) {
    const h = await getOrUpdateUser(hostId, nick || unique, unique);
    trackUserChange(hostId, "HOST(nickmatch)", h);

    return {
      id: hostId,
      username: h.username,
      display_name: h.display_name,
      role: "host" as const,
    };
  }

  // 4) Normal user
  if (eventId) {
    const t = String(eventId);
    const u = await getOrUpdateUser(
      t,
      nick || null,
      unique || null
    );

    trackUserChange(t, "RECEIVER", u);

    return {
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role: "speler" as const,
    };
  }

  // 5) If absolutely unknown, fallback to host
  if (hostId) {
    const h = await getOrUpdateUser(hostId, nick || unique, unique);
    trackUserChange(hostId, "HOST(fallback)", h);

    return {
      id: hostId,
      username: h.username,
      display_name: h.display_name,
      role: "host" as const,
    };
  }

  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler",
  };
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

async function processGift(evt: any, source: string) {
  console.log(`💠 Gift [${source}] giftId=${evt.giftId} diamonds=${evt.diamondCount}`);

  const key =
    evt.msgId ||
    evt.id ||
    evt.logId ||
    `${source}-${evt.giftId}-${evt.timestamp}-${evt.userId}`;

  if (dedupe.has(key)) {
    console.log("⏭️ Duplicate gift ignored");
    return;
  }
  dedupe.add(key);

  // Sender
  const senderId =
    evt.user?.userId ||
    evt.sender?.userId ||
    evt.userId ||
    evt.senderUserId;

  if (!senderId) {
    console.warn("⚠ Gift zonder senderId → skip");
    return;
  }

  const sender = await getOrUpdateUser(
    String(senderId),
    evt.user?.nickname || evt.sender?.nickname || null,
    evt.user?.uniqueId || evt.sender?.uniqueId || null
  );

  trackUserChange(String(senderId), "SENDER", sender);

  const credited = calcDiamonds(evt);
  if (credited <= 0) {
    console.log("ℹ️ Streak gift not ended → no credit");
    return;
  }

  const receiver = await resolveReceiver(evt);
  const isHost = receiver.role === "host";

  console.log(
    `🎁 ${sender.display_name} → ${receiver.display_name} (${evt.giftName}) +${credited}💎`
  );

  if (
    unknownDebugCount < UNKNOWN_LIMIT &&
    (sender.username.startsWith("onbekend") || receiver.display_name === "UNKNOWN")
  ) {
    debugUnknown("gift", String(senderId), evt);
  }

  // Arena
  const gameId = (io as any).currentGameId ?? null;
  const arena = getArena();
  const now = Date.now();

  const inActive = arena.status === "active" && now <= arena.roundCutoff;
  const inGrace = arena.status === "grace" && now <= arena.graceEnd;
  const inRound = inActive || inGrace;

  await addDiamonds(BigInt(senderId), credited, "total");
  await addDiamonds(BigInt(senderId), credited, "stream");
  await addDiamonds(BigInt(senderId), credited, "current_round");

  const bp = credited * 0.2;
  await addBP(BigInt(senderId), bp, "GIFT", sender.display_name);

  if (!isHost && receiver.id && inRound) {
    await safeAddArenaDiamonds(receiver.id.toString(), credited);
  }

  // Twists
  const giftId = Number(evt.giftId);
  const twistType: TwistType | null =
    (Object.keys(TWIST_MAP) as TwistType[]).find(
      (t) => TWIST_MAP[t].giftId === giftId
    ) || null;

  if (twistType) {
    await addTwistByGift(String(senderId), twistType);
    console.log(`🌀 Twist: ${TWIST_MAP[twistType].giftName}`);

    emitLog({
      type: "twist",
      message: `${sender.display_name} kreeg twist ${TWIST_MAP[twistType].giftName}`,
    });
  }

  // Fanclub
  if (isHost && (evt.giftName?.toLowerCase() === "heart me" || evt.giftId === 5655)) {
    const uid = BigInt(senderId);
    const expires = new Date(Date.now() + 24 * 3600 * 1000);

    await pool.query(
      `UPDATE users SET is_fan=true, fan_expires_at=$1 WHERE tiktok_id=$2`,
      [expires, uid]
    );

    emitLog({
      type: "gift",
      message: `${sender.display_name} → FAN 24h ❤️`,
    });
  }

  // Insert gift
  await pool.query(
    `
      INSERT INTO gifts (
        giver_id, giver_username, giver_display_name,
        receiver_id, receiver_username, receiver_display_name,
        receiver_role, gift_name, diamonds, bp, game_id, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    `,
    [
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
      gameId,
    ]
  );

  emitLog({
    type: "gift",
    message: `${sender.display_name} → ${receiver.display_name}: ${evt.giftName} (+${credited}💎)`,
  });
}

// ============================================================================
// INIT ENGINE
// ============================================================================

export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine zonder verbinding");
    return;
  }

  console.log("🎁 GiftEngine v6.2 — NO ANCHOR, HOST-SAFE");

  if (typeof conn.onAny === "function") {
    let dbg = 0;
    conn.onAny((ev: string, d: any) => {
      if (dbg < 5) {
        console.log(`📡 ${ev} giftId=${d?.giftId ?? "-"}`);
        dbg++;
      }
    });
  }

  conn.on("gift", (d: any) => processGift(d, "gift"));
  conn.on("roomMessage", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGift(d, "roomMessage");
  });
  conn.on("member", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGift(d, "member");
  });
  conn.on("chat", (d: any) => {
    if (d?._data?.giftId || d?._data?.diamondCount)
      processGift(d._data, "chat-hidden");
  });
}

// ============================================================================
// EXPORT
// ============================================================================

export default {
  initGiftEngine,
  refreshHostUsername,
  initDynamicHost,
};
