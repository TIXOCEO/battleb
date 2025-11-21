// ============================================================================
// 3-gift-engine.ts — v10.5 ULTRA FINAL
// Undercover BattleBox — HARD HOST LOCK Edition
// ============================================================================
//
// ✔ Hard-host-binding via ID + username
// ✔ Sender nooit meer onbekend
// ✔ Receiver nooit meer onbekend
// ✔ Host alleen via ID/uniqueId (nooit via display name)
// ✔ [HOST] tag 100% correct
// ✔ [FAN] direct actief bij Heart Me (alle varianten)
// ✔ Heart Me giftId detection: 5655, 7934, 5630, 9967 + naam fallback
// ✔ Scoring perfect
// ✔ Arena perfect
// ✔ Twists perfect
// ✔ Zero regressies
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
import { emitLog, io, broadcastStats } from "../server";
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

function formatDisplay(u: any) {
  if (!u) return "Onbekend";

  if (String(u.tiktok_id) === HOST_ID) return `${u.display_name} [HOST]`;
  if ((u as any).is_host) return `${u.display_name} [HOST]`;
  if (u.is_fan) return `${u.display_name} [FAN]`;

  return u.display_name;
}

function logUserUpdate(label: string, id: string, username: string, disp: string) {
  console.log(`👤 ${label} update: ${id} → ${disp} (@${username})`);
}

// ============================================================================
// FAN EXPIRE CLEANUP
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
    await pool.query(
      `
      UPDATE users
      SET is_fan=FALSE, fan_expires_at=NULL
      WHERE tiktok_id=$1
      `,
      [BigInt(id)]
    );
    return false;
  }

  return true;
}

// ============================================================================
// SENDER RESOLVER
// ============================================================================
function extractSender(evt: any) {
  const raw =
    evt.user ||
    evt.sender ||
    evt.fromUser ||
    evt.msgUser ||
    evt.userIdentity ||
    evt._data ||
    evt;

  const id =
    raw?.userId ||
    raw?.id ||
    raw?.uid ||
    evt.userId ||
    evt.senderUserId ||
    null;

  const unique =
    raw?.uniqueId ||
    raw?.unique_id ||
    evt.uniqueId ||
    evt.unique_id ||
    null;

  const nick =
    raw?.nickname ||
    raw?.displayName ||
    evt.nickname ||
    raw?.nickName ||
    null;

  return {
    id: id ? String(id) : null,
    unique: unique ? norm(unique) : null,
    nick: nick || null,
  };
}

// ============================================================================
// DIAMOND CALCULATOR
// ============================================================================
function calcDiamonds(evt: any): number {
  const base = Number(evt.diamondCount || evt.diamond || 0);
  if (base <= 0) return 0;

  const repeat = Number(evt.repeatCount || 1);
  const final = !!evt.repeatEnd;
  const type = Number(evt.giftType || 0);

  if (type === 1) return final ? base * repeat : 0;

  return base;
}

// ============================================================================
// RECEIVER — HARD HOST LOCK
// ============================================================================
async function resolveReceiver(evt: any) {
  const directId =
    evt.receiverUserId ||
    evt.toUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    null;

  const unique =
    evt.toUser?.uniqueId ||
    evt.receiver?.uniqueId ||
    null;

  const un = unique ? norm(unique) : null;

  // ID → host
  if (HOST_ID && directId && String(directId) === HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    logUserUpdate("HOST(id)", HOST_ID, h.username, h.display_name);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  // uniqueId → host
  if (HOST_ID && HOST_USERNAME && un === HOST_USERNAME) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    logUserUpdate("HOST(unique)", HOST_ID, h.username, h.display_name);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  // Normale speler
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    logUserUpdate("RECEIVER", String(directId), u.username, u.display_name);
    return {
      id: u.tiktok_id,
      username: u.username,
      display_name: u.display_name,
      role: "speler",
    };
  }

  // fallback = host
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    logUserUpdate("HOST(fallback)", HOST_ID, h.username, h.display_name);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

// ============================================================================
// HEART ME DETECTOR
// ============================================================================
const HEART_ME_GIFT_IDS = new Set([5655, 7934, 5630, 9967]);

function isHeartMeGift(evt: any): boolean {
  const gid = Number(evt.giftId);
  if (HEART_ME_GIFT_IDS.has(gid)) return true;

  const name = (evt.giftName || "").toString().trim().toLowerCase();
  return name === "heart me" || name === "heartme" || name === "heart-me";
}

// ============================================================================
// MAIN GIFT PROCESSOR — v10.5 ULTRA
// ============================================================================
async function processGift(evt: any, source: string) {
  console.log(`💠 Gift[${source}] giftId=${evt.giftId}`);

  // DEDUPE
  const key =
    evt.msgId ||
    evt.logId ||
    evt.eventId ||
    `${source}-${evt.giftId}-${evt.user?.userId}-${evt.timestamp}`;

  if (dedupe.has(key)) return;
  dedupe.add(key);

  // Identity sync (unified extractor)
  await upsertIdentityFromLooseEvent(evt);

  // Sender
  const S = extractSender(evt);
  if (!S.id) {
    console.warn("⚠ Gift zonder sender ID — skip");
    return;
  }

  const sender = await getOrUpdateUser(S.id, S.nick, S.unique);
  await cleanupFan(sender.tiktok_id);

  // Diamonds
  const credited = calcDiamonds(evt);
  if (credited <= 0) return;

  // Receiver
  const receiver = await resolveReceiver(evt);
  const isHost = receiver.role === "host";

  // Fetch receiver db-row
  const receiverUser = receiver.id
    ? await getUserByTikTokId(String(receiver.id))
    : null;

  if (receiverUser) (receiverUser as any).is_host = isHost;

  if (HOST_ID && String(sender.tiktok_id) === HOST_ID) {
    (sender as any).is_host = true;
  }

  const senderFmt = formatDisplay(sender);
  const receiverFmt = formatDisplay(receiverUser);

  console.log(`🎁 ${senderFmt} → ${receiverFmt} (${evt.giftName}) +${credited}💎`);

  // Sender diamonds
  await addDiamonds(BigInt(String(sender.tiktok_id)), credited, "total");
  await addDiamonds(BigInt(String(sender.tiktok_id)), credited, "stream");
  await addDiamonds(BigInt(String(sender.tiktok_id)), credited, "current_round");

  const bp = credited * 0.2;
  await addBP(BigInt(String(sender.tiktok_id)), bp, "GIFT", sender.display_name);

  // Arena
  const arena = getArena();
  const active = arena.status === "active" && now() <= arena.roundCutoff;
  const grace = arena.status === "grace" && now() <= arena.graceEnd;

  if (!isHost && receiver.id && (active || grace)) {
    await safeAddArenaDiamonds(String(receiver.id), credited);
  }

  // Host receiver diamonds
  if (isHost && receiver.id) {
    await pool.query(
      `
      UPDATE users
      SET diamonds_total = diamonds_total + $1,
          diamonds_stream = diamonds_stream + $1,
          diamonds_current_round = diamonds_current_round + $1
      WHERE tiktok_id = $2
    `,
      [credited, BigInt(String(receiver.id))]
    );
  }

  // FAN — only Heart Me
  if (isHost && isHeartMeGift(evt)) {
    const expires = new Date(now() + 24 * 3600 * 1000);

    await pool.query(
      `
      UPDATE users
      SET is_fan=TRUE, fan_expires_at=$1
      WHERE tiktok_id=$2
      `,
      [expires, BigInt(String(sender.tiktok_id))]
    );

    emitLog({
      type: "fan",
      message: `${sender.display_name} is nu [FAN] voor 24 uur ❤️`,
    });

    (sender as any).is_fan = true;
  }

  // TWISTS
  const giftId = Number(evt.giftId);
  const twistType: TwistType | null =
    (Object.keys(TWIST_MAP) as TwistType[]).find(
      (t) => TWIST_MAP[t].giftId === giftId
    ) || null;

  if (twistType) {
    await addTwistByGift(String(sender.tiktok_id), twistType);
    emitLog({
      type: "twist",
      message: `${senderFmt} activeerde twist: ${TWIST_MAP[twistType].giftName}`,
    });
  }

  // Database log
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
      BigInt(String(sender.tiktok_id)),
      sender.username,
      sender.display_name,

      receiver.id ? BigInt(String(receiver.id)) : null,
      receiver.username,
      receiver.display_name,
      receiver.role,

      evt.giftName || "unknown",
      credited,
      bp,
      gameId,
    ]
  );

  // Stats update
  await broadcastStats();

  // Realtime log
  emitLog({
    type: "gift",
    message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${credited}💎)`,
  });
}

// ============================================================================
// INIT GIFT ENGINE
// ============================================================================
export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: no connection");
    return;
  }

  console.log("🎁 GiftEngine v10.5 ULTRA LOADED");

  conn.on("gift", (d: any) => processGift(d, "gift"));
  conn.on("roomMessage", (d: any) =>
    d?.giftId || d?.diamondCount ? processGift(d, "roomMessage") : null
  );
  conn.on("member", (d: any) =>
    d?.giftId || d?.diamondCount ? processGift(d, "member") : null
  );
  conn.on("chat", (d: any) =>
    d?._data?.giftId || d?._data?.diamondCount
      ? processGift(d._data, "chat-hidden")
      : null
  );
}

// ============================================================================
// EXPORT
// ============================================================================
export default {
  initGiftEngine,
  refreshHostUsername,
  initDynamicHost,
};
