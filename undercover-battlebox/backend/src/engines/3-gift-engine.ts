// ============================================================================
// 3-gift-engine.ts — v11.1 FINAL HOST PROFILE EDITION (TSC FIXED)
// ============================================================================

import pool from "../db";
import {
  getOrUpdateUser,
  getUserByTikTokId,
  upsertIdentityFromLooseEvent,
} from "./2-user-engine";

import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";

import {
  emitLog,
  io,
  broadcastStats,
  broadcastPlayerLeaderboard,
  getActiveHost,
} from "../server";

import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// DEDUPE
// ============================================================================

const dedupe = new Set<string>();
setInterval(() => dedupe.clear(), 20000);

function makeDedupeKey(evt: any, source: string) {
  const roughTs = Math.round(Number(evt.timestamp || Date.now()) / 50);

  return (
    evt.msgId ||
    evt.logId ||
    evt.eventId ||
    `${source}-${evt.giftId}-${evt.user?.userId}-${evt.receiverUserId}-${roughTs}`
  );
}

// ============================================================================
// NORMALIZERS
// ============================================================================
function norm(v: any) {
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
  if (u.is_host) return `${u.display_name} [HOST]`;
  if (u.is_fan) return `${u.display_name} [FAN]`;
  return u.display_name;
}

// ============================================================================
// FAN EXPIRE
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
      `UPDATE users SET is_fan=FALSE, fan_expires_at=NULL WHERE tiktok_id=$1`,
      [BigInt(id)]
    );
    return false;
  }

  return true;
}

// ============================================================================
// SENDER PARSER
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

  return {
    id:
      raw?.userId ||
      raw?.uid ||
      raw?.id ||
      evt.userId ||
      evt.senderUserId ||
      null,
    unique: norm(
      raw?.uniqueId ||
      raw?.unique_id ||
      evt.uniqueId ||
      evt.unique_id ||
      null
    ),
    nick:
      raw?.nickname ||
      raw?.displayName ||
      evt.nickname ||
      raw?.nickName ||
      null,
  };
}

// ============================================================================
// DIAMONDS
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
// RECEIVER PARSER — HOST LOCK
// ============================================================================
async function resolveReceiver(evt: any) {
  const active = getActiveHost();
  const HOST_ID_RAW = active?.id || null;
  const HOST_USERNAME = active?.username || "";

  // safe string
  const HOST_ID = HOST_ID_RAW ? String(HOST_ID_RAW) : "";

  const directId =
    evt.receiverUserId ||
    evt.toUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    null;

  const unique =
    evt.receiver?.uniqueId ||
    evt.receiver?.unique_id ||
    evt.toUser?.uniqueId ||
    evt.toUser?.unique_id ||
    null;

  const un = unique ? norm(unique) : null;

  // ID lock
  if (HOST_ID && directId && String(directId) === HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  // username lock
  if (HOST_USERNAME && un === HOST_USERNAME) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    return {
      id: u.tiktok_id,
      username: u.username,
      display_name: u.display_name,
      role: "speler",
    };
  }

  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

// ============================================================================
// HEART ME
// ============================================================================
const HEART_ME_GIFT_IDS = new Set([7934]);

function isHeartMeGift(evt: any): boolean {
  const name = (evt.giftName || "").toLowerCase().trim();
  if (name === "heart me") return true;
  return HEART_ME_GIFT_IDS.has(Number(evt.giftId));
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================
async function processGift(evt: any, source: string) {
  try {
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    await upsertIdentityFromLooseEvent(evt);

    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(String(S.id), S.nick, S.unique);
    await cleanupFan(sender.tiktok_id);

    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const receiverUser = receiver.id
      ? await getUserByTikTokId(String(receiver.id))
      : null;

    if (receiverUser) (receiverUser as any).is_host = isHostReceiver;

    const senderFmt = formatDisplay(sender);
    const receiverFmt = formatDisplay(receiverUser);

    const arena = getArena();
    const nowMs = now();

    const inRound =
      (arena.status === "active" && nowMs <= arena.roundCutoff) ||
      (arena.status === "grace" && nowMs <= arena.graceEnd);

    const is_round_gift = inRound && !isHostReceiver;
    const round_active = arena.status === "active";

    // sender points
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "total");
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "stream");
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "current_round");

    await addBP(
      BigInt(sender.tiktok_id),
      diamonds * 0.2,
      "GIFT",
      sender.display_name
    );

    // arena diamonds
    if (receiver.id && is_round_gift) {
      await safeAddArenaDiamonds(String(receiver.id), diamonds);
    }

    // host receiver
    if (isHostReceiver && receiver.id) {
      await pool.query(
        `
        UPDATE users
        SET diamonds_total = diamonds_total + $1,
            diamonds_stream = diamonds_stream + $1,
            diamonds_current_round = diamonds_current_round + $1
        WHERE tiktok_id=$2
      `,
        [diamonds, BigInt(String(receiver.id))]
      );
    }

    // fan gift
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(nowMs + 24 * 3600 * 1000);
      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1 WHERE tiktok_id=$2`,
        [expires, BigInt(sender.tiktok_id)]
      );

      emitLog({
        type: "fan",
        message: `${sender.display_name} is nu FAN ❤️ (24u)`,
      });
    }

    // twist gifts
    const giftId = Number(evt.giftId);
    const twistType =
      (Object.keys(TWIST_MAP) as TwistType[])
        .find(t => TWIST_MAP[t].giftId === giftId) || null;

    if (twistType) {
      await addTwistByGift(String(sender.tiktok_id), twistType);
      emitLog({
        type: "twist",
        message: `${senderFmt} ontving twist: ${TWIST_MAP[twistType].giftName}`,
      });
    }

    const gameId = (io as any).currentGameId ?? null;

    await pool.query(
      `
      INSERT INTO gifts (
        giver_id, giver_username, giver_display_name,
        receiver_id, receiver_username, receiver_display_name,
        receiver_role,
        gift_name, diamonds, bp,
        game_id,
        is_host_gift,
        is_round_gift,
        round_active,
        arena_id,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,
              $8,$9,$10,$11,$12,$13,$14,$15,NOW())
    `,
      [
        BigInt(sender.tiktok_id),
        sender.username,
        sender.display_name,

        receiver.id ? BigInt(String(receiver.id)) : null,
        receiver.username,
        receiver.display_name,
        receiver.role,

        evt.giftName || "unknown",
        diamonds,
        diamonds * 0.2,

        gameId,
        isHostReceiver,
        is_round_gift,
        round_active,
        Number(arena.round),
      ]
    );

    await broadcastStats();
    await broadcastPlayerLeaderboard();

    emitLog({
      type: "gift",
      message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${diamonds}💎)`,
    });

  } catch (err) {
    console.error("❌ processGift ERROR:", err);
  }
}

// ============================================================================
// INIT ENGINE
// ============================================================================
export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: no connection");
    return;
  }

  console.log("🎁 GiftEngine v11.1 LOADED");

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
};
