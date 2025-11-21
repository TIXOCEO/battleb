// ============================================================================
// 3-gift-engine.ts — v10.9 ULTRA PATCH (Danny Stable)
// FIXED: TikTok proxy fields • Deep identity sync • Receiver-lock hard patch
// STRICT HEART ME • Twist Inventory MODEL A • Arena-round sync guaranteed
// ============================================================================

import pool, { getSetting } from "../db";

import {
  getOrUpdateUser,
  getUserByTikTokId,
  upsertIdentityFromLooseEvent,
} from "./2-user-engine";

import { addDiamonds, addBP } from "./4-points-engine";

import {
  getArena,
  safeAddArenaDiamonds,
} from "./5-game-engine";

import {
  emitLog,
  io,
  broadcastStats,
  broadcastRoundLeaderboard,
} from "../server";

import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";


// ============================================================================
// HOST LOCK CACHE
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


// ============================================================================
// UTILS
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


// ============================================================================
// FAN EXPIRATION CHECK
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
// SENDER EXTRACTOR — ULTRA ROBUST (TikTok proxy variations supported)
// ============================================================================
function extractSender(evt: any) {
  // Euler/TikTok proxy sometimes wraps event in {data:{}}
  const raw =
    evt.user ||
    evt.sender ||
    evt.fromUser ||
    evt.msgUser ||
    evt.userIdentity ||
    evt._data ||
    evt?.data ||
    evt;

  return {
    id:
      raw?.userId ||
      raw?.id ||
      raw?.uid ||
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
// RECEIVER — ULTRA FIX: covers all TikTok/Euler variations
// ============================================================================
async function resolveReceiver(evt: any) {
  const directId =
    evt.receiverUserId ||
    evt.toUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    evt?.data?.receiverUserId ||
    null;

  const unique =
    evt.receiver?.uniqueId ||
    evt.receiver?.unique_id ||
    evt.toUser?.uniqueId ||
    evt.toUser?.unique_id ||
    null;

  const un = unique ? norm(unique) : null;

  // HARD HOST LOCK
  if (HOST_ID && directId && String(directId) === HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  if (HOST_USERNAME && un === HOST_USERNAME) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    return { id: u.tiktok_id, username: u.username, display_name: u.display_name, role: "speler" };
  }

  // Fallback to host if TikTok doesn't send receiver
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}


// ============================================================================
// STRICT HEART ME
// ============================================================================
const HEART_ME_GIFT_IDS = new Set([7934]);

function isHeartMeGift(evt: any): boolean {
  const name = (evt.giftName || "").toString().trim().toLowerCase();
  if (name === "heart me") return true;
  return HEART_ME_GIFT_IDS.has(Number(evt.giftId));
}


// ============================================================================
// MAIN PROCESSOR — ULTRA PATCH (Stable, Proxy-friendly)
// ============================================================================
async function processGift(evt: any, source: string) {
  try {
    console.log(`💠 Gift[${source}] ${evt.giftId}`);

    // ----- DEDUPE KEY -----
    const key =
      evt.msgId ||
      evt.logId ||
      evt.eventId ||
      `${source}-${evt.giftId}-${evt.timestamp}-${evt?.user?.userId}`;

    if (dedupe.has(key)) return;
    dedupe.add(key);

    // ----- identity update -----
    await upsertIdentityFromLooseEvent(evt);

    // ----- SENDER -----
    const S = extractSender(evt);
    if (!S.id) return console.warn("⚠ Gift zonder sender ID — SKIP");

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);
    await cleanupFan(sender.tiktok_id);

    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    // ----- RECEIVER -----
    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const receiverUser = receiver.id
      ? await getUserByTikTokId(String(receiver.id))
      : null;

    if (receiverUser) (receiverUser as any).is_host = isHostReceiver;
    if (HOST_ID && String(sender.tiktok_id) === HOST_ID)
      (sender as any).is_host = true;

    const senderFmt = formatDisplay(sender);
    const receiverFmt = formatDisplay(receiverUser);

    // ----- ARENA STATUS -----
    const arena = getArena();
    const nowMs = now();

    const inRound =
      (arena.status === "active" && nowMs <= arena.roundCutoff) ||
      (arena.status === "grace" && nowMs <= arena.graceEnd);

    const is_round_gift = inRound && !isHostReceiver;
    const round_active = arena.status === "active";

    console.log(
      `🎁 ${senderFmt} → ${receiverFmt}: ${evt.giftName} +${diamonds} (round=${is_round_gift})`
    );

    // ========================================================================
    // 1. ADD DIAMONDS / BP TO SENDER
    // ========================================================================
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "total");
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "stream");
    await addDiamonds(BigInt(sender.tiktok_id), diamonds, "current_round");

    const bp = diamonds * 0.2;
    await addBP(BigInt(sender.tiktok_id), bp, "GIFT", sender.display_name);

    // ========================================================================
    // 2. ARENA ROUND DIAMONDS
    // ========================================================================
    if (receiver.id && is_round_gift) {
      await safeAddArenaDiamonds(String(receiver.id), diamonds);
    }

    // ========================================================================
    // 3. HOST RECEIVER LOGIC
    // ========================================================================
    if (isHostReceiver && receiver.id) {
      await pool.query(
        `
        UPDATE users
        SET diamonds_total = diamonds_total + $1,
            diamonds_stream = diamonds_stream + $1,
            diamonds_current_round = diamonds_current_round + $1
        WHERE tiktok_id = $2
      `,
        [diamonds, BigInt(String(receiver.id))]
      );
    }

    // ========================================================================
    // 4. FAN (STRICT HEART ME)
    // ========================================================================
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(nowMs + 24 * 3600 * 1000);

      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1 WHERE tiktok_id=$2`,
        [expires, BigInt(String(sender.tiktok_id))]
      );

      (sender as any).is_fan = true;

      emitLog({
        type: "fan",
        message: `${sender.display_name} is nu FAN ❤️ (24u)`,
      });
    }

    // ========================================================================
    // 5. TWIST VIA GIFT (MODEL A)
    // ========================================================================
    const giftId = Number(evt.giftId);
    const twistType =
      (Object.keys(TWIST_MAP) as TwistType[]).find(
        (t) => TWIST_MAP[t].giftId === giftId
      ) || null;

    if (twistType) {
      await addTwistByGift(String(sender.tiktok_id), twistType);

      emitLog({
        type: "twist",
        message: `${senderFmt} ontving twist: ${TWIST_MAP[twistType].giftName}`,
      });
    }

    // ========================================================================
    // 6. STORE GIFT IN DATABASE
    // ========================================================================
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
        bp,

        gameId,
        isHostReceiver,
        is_round_gift,
        round_active,
        Number(arena.round),
      ]
    );

    // ========================================================================
    // 7. UPDATE UI
    // ========================================================================
    await broadcastStats();
    await broadcastRoundLeaderboard();

    emitLog({
      type: "gift",
      message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${diamonds}💎)`,
    });

  } catch (err) {
    console.error("❌ processGift ERROR:", err);
  }
}


// ============================================================================
// ENGINE INIT (Proxy-Friendly)
// ============================================================================
export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: no connection");
    return;
  }

  console.log("🎁 GiftEngine v10.9 ULTRA PATCH LOADED");

  // core TikTok gift
  conn.on("gift", (d: any) => processGift(d, "gift"));

  // roomMessage sometimes carries gift payload
  conn.on("roomMessage", (d: any) => {
    if (d?.giftId || d?.diamondCount || d?.data?.giftId)
      processGift(d?.data || d, "roomMessage");
  });

  // member sometimes carries 'entry gift'
  conn.on("member", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGift(d, "member");
  });

  // chat wrapper gift
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
  initDynamicHost: refreshHostUsername,
};
