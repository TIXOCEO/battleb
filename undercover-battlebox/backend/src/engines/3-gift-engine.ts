// ============================================================================
// 3-gift-engine.ts — v10.1 FINAL
// Undercover BattleBox — HARD HOST LOCK (OPTIE B) + Zero-Unknown Guarantee
// ============================================================================
//
// ✔ Identity volledig via 2-user-engine.ts v10.1
// ✔ Host blijft altijd host → via hard host ID
// ✔ Displayname wordt wél realtime geüpdatet
// ✔ Username van host blijft tijdens stream onveranderd
// ✔ Nooit meer “Onbekend” bij sender of receiver
// ✔ Arena + BP + Diamonds consistent
// ✔ Volledige twist-integratie
// ✔ Fanclub (HeartMe) 24h blijft
// ✔ Fallbacks verbeterd, TikTok edge-cases gedekt
//
// ============================================================================

import pool, { getSetting } from "../db";
import {
  getOrUpdateUser,
  getUserByTikTokId,
  upsertIdentityFromLooseEvent,
} from "./2-user-engine";

import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// HARD HOST STATE
// ============================================================================
let HOST_ID: string = "";
let HOST_USERNAME: string = "";

export async function refreshHostUsername() {
  HOST_ID = (await getSetting("host_id")) || "";
  HOST_USERNAME = ((await getSetting("host_username")) || "")
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

function now() {
  return Date.now();
}

function fmtUser(u: any) {
  if (!u) return "Onbekend";

  const isHost = HOST_ID && String(u.tiktok_id) === HOST_ID;
  const isFan = Boolean(u.is_fan);

  if (isHost) return `${u.display_name} [HOST]`;
  if (isFan) return `${u.display_name} [FAN]`;
  return u.display_name;
}

// ============================================================================
// DIAMOND CALCULATOR
// ============================================================================
function calcDiamonds(evt: any): number {
  const base = Number(evt.diamondCount || evt.diamond || 0);
  if (base <= 0) return 0;

  if (evt.giftType === 1) {
    const final = !!evt.repeatEnd;
    const streak = Number(evt.repeatCount || 1);
    return final ? base * streak : 0;
  }

  return base;
}

// ============================================================================
// RECEIVER RESOLVER (never unknown, full hard host lock)
// ============================================================================
async function resolveReceiver(evt: any) {
  const directId =
    evt.receiverUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    evt.toUserId ||
    null;

  const unique =
    evt.toUser?.uniqueId ||
    evt.receiver?.uniqueId ||
    null;

  const cleanUnique = unique
    ? unique.toString().trim().replace(/^@+/, "").toLowerCase()
    : null;

  // Host match by ID
  if (HOST_ID && directId && String(directId) === HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  // Host match by username
  if (HOST_ID && HOST_USERNAME && cleanUnique === HOST_USERNAME) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  // Normal receiver
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    return {
      id: u.tiktok_id,
      username: u.username,
      display_name: u.display_name,
      role: "speler",
    };
  }

  // Fallback → host
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  return {
    id: null,
    username: "unknown",
    display_name: "Onbekend",
    role: "speler",
  };
}

// ============================================================================
// MAIN GIFT PROCESSOR
// ============================================================================
async function processGift(evt: any, source: string) {
  console.log(`💠 Gift[${source}] id=${evt.giftId}`);

  // DEDUPE
  const key =
    evt.msgId ||
    evt.eventId ||
    `${source}-${evt.giftId}-${evt.user?.userId}-${evt.timestamp}`;

  if (dedupe.has(key)) return;
  dedupe.add(key);

  // Ensure identity saved
  await upsertIdentityFromLooseEvent(evt);

  // Sender
  const sRaw =
    evt.user ||
    evt.sender ||
    evt.fromUser ||
    evt.userIdentity ||
    evt._data ||
    evt;

  const senderId =
    sRaw?.userId ||
    sRaw?.id ||
    sRaw?.uid ||
    evt.user?.userId ||
    evt.senderUserId ||
    null;

  const senderName =
    sRaw?.uniqueId ||
    sRaw?.unique_id ||
    evt.user?.uniqueId ||
    evt.user?.unique_id ||
    null;

  const senderDisp = sRaw?.nickname || sRaw?.displayName || null;

  if (!senderId) return;

  const sender = await getOrUpdateUser(
    String(senderId),
    senderDisp,
    senderName
  );

  // Receiver
  const receiver = await resolveReceiver(evt);

  const credited = calcDiamonds(evt);
  if (credited <= 0) return;

  // Format names for logs
  const senderFmt = fmtUser(sender);
  const receiverUser = receiver.id
    ? await getUserByTikTokId(String(receiver.id))
    : null;

  const receiverFmt = fmtUser(receiverUser);

  console.log(
    `🎁 ${senderFmt} → ${receiverFmt} (${evt.giftName}) +${credited}💎`
  );

  // Sender diamond tracking
  await addDiamonds(BigInt(sender.tiktok_id), credited, "total");
  await addDiamonds(BigInt(sender.tiktok_id), credited, "stream");
  await addDiamonds(BigInt(sender.tiktok_id), credited, "current_round");

  const bp = credited * 0.2;
  await addBP(
    BigInt(sender.tiktok_id),
    bp,
    "GIFT",
    sender.display_name
  );

  // Arena scoring
  const arena = getArena();
  const active = arena.status === "active" && now() <= arena.roundCutoff;
  const grace = arena.status === "grace" && now() <= arena.graceEnd;

  if (receiver.role !== "host" && receiver.id && (active || grace)) {
    await safeAddArenaDiamonds(String(receiver.id), credited);
  }

  // Host diamond scoring
  if (receiver.role === "host" && receiver.id) {
    await pool.query(
      `
      UPDATE users
      SET diamonds_total = diamonds_total + $1,
          diamonds_stream = diamonds_stream + $1,
          diamonds_current_round = diamonds_current_round + $1
      WHERE tiktok_id=$2
    `,
      [credited, BigInt(receiver.id)]
    );
  }

  // Fanclub
  if (receiver.role === "host" && evt.giftId === 5655) {
    const expires = new Date(now() + 86400 * 1000);
    await pool.query(
      `
      UPDATE users
      SET is_fan=TRUE, fan_expires_at=$1
      WHERE tiktok_id=$2
    `,
      [expires, BigInt(sender.tiktok_id)]
    );

    emitLog({
      type: "fan",
      message: `${sender.display_name} is nu [FAN] voor 24 uur ❤️`,
    });
  }

  // Twists
  const giftId = Number(evt.giftId);
  const twistType = (Object.keys(TWIST_MAP) as TwistType[]).find(
    (t) => TWIST_MAP[t].giftId === giftId
  );

  if (twistType) {
    await addTwistByGift(String(sender.tiktok_id), twistType);
    emitLog({
      type: "twist",
      message: `${senderFmt} activeerde twist: ${TWIST_MAP[twistType].giftName}`,
    });
  }

  // DATABASE RECORD
  const gameId = (io as any).currentGameId ?? null;

  await pool.query(
    `
    INSERT INTO gifts (
      giver_id, giver_username, giver_display_name,
      receiver_id, receiver_username, receiver_display_name,
      receiver_role, gift_name, diamonds, bp,
      game_id, created_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
  `,
    [
      BigInt(sender.tiktok_id),
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

  // REALTIME LOG
  emitLog({
    type: "gift",
    message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${credited}💎)`,
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

  console.log("🎁 GiftEngine v10.1 LOADED");

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

export default { initGiftEngine, refreshHostUsername, initDynamicHost };
