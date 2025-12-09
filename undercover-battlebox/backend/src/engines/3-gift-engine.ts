/* ============================================================================
   3-gift-engine.ts — v14.6 HOST NORMALIZATION PATCH
   ✔ Gesynchroniseerd met server.ts v16.8 host-lowercase model
   ✔ Host-detectie nu 100% consistent
   ✔ Self-gift detectie strikt en correct
   ✔ Rest van de logica volledig behouden
============================================================================ */

import pool from "../db";

import {
  getOrUpdateUser,
  getUserByTikTokId,
  upsertIdentityFromLooseEvent,
} from "./2-user-engine";

import {
  emitLog,
  io,
  broadcastStats,
  getActiveHost,
  broadcastPlayerLeaderboard,
  broadcastGifterLeaderboard,
  broadcastHostDiamonds
} from "../server";

import { addBP } from "./4-points-engine";
import { getArena, emitArena } from "./5-game-engine";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

/* ============================================================================
   GAME HELPERS
============================================================================ */

function getActiveGameId(): number | null {
  const id = (io as any)?.currentGameId;
  return typeof id === "number" && id > 0 ? id : null;
}

async function isGameActive(): Promise<boolean> {
  const gid = getActiveGameId();
  if (!gid) return false;

  const r = await pool.query(
    `SELECT id FROM games WHERE id=$1 AND status='running'`,
    [gid]
  );
  return r.rows.length > 0;
}

/* ============================================================================
   DEDUPE
============================================================================ */

const dedupe = new Set<string>();
setInterval(() => dedupe.clear(), 20000);

function makeDedupeKey(evt: any, source: string) {
  const rough = Math.round(Number(evt.timestamp || Date.now()) / 50);
  return (
    evt.msgId ||
    evt.logId ||
    evt.eventId ||
    `${source}-${evt.giftId}-${evt.user?.userId}-${evt.receiverUserId}-${rough}`
  );
}

/* ============================================================================
   HELPERS
============================================================================ */

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
  return u?.display_name || "Onbekend";
}

/* ============================================================================
   EXTRACT SENDER
============================================================================ */

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
      raw?.nickName ||
      evt.nickname ||
      null
  };
}

/* ============================================================================
   DIAMOND CALC
============================================================================ */

function calcDiamonds(evt: any): number {
  const base = Number(evt.diamondCount || evt.diamond || 0);
  if (base <= 0) return 0;

  const repeat = Number(evt.repeatCount || 1);
  const final = !!evt.repeatEnd;
  const type = Number(evt.giftType || 0);

  if (type === 1) return final ? base * repeat : 0;
  return base;
}

/* ============================================================================
   RESOLVE RECEIVER — HOST NORMALIZATION PATCHED
============================================================================ */

async function resolveReceiver(evt: any) {
  const host = getActiveHost();
  const HOST_ID = host?.id ? String(host.id) : null;
  const HOST_USER = host?.username ? norm(host.username) : ""; // ✔ lowercase normalized now

  const directId =
    evt.receiverUserId ||
    evt.toUserId ||
    evt.toUser?.userId ||
    evt.receiver?.userId ||
    null;

  const unique =
    evt.receiver?.uniqueId ||
    evt.receiver?.unique_id ||
    null;

  const un = unique ? norm(unique) : null; // ✔ exact lowercase compare

  // --------------------------------------------------------------------------
  // SELF-GIFT → host (strict ID match)
  // --------------------------------------------------------------------------
  if (evt.userId && directId && String(evt.userId) === String(directId)) {
    if (HOST_ID) {
      const h = await getOrUpdateUser(HOST_ID, null, null);
      return {
        id: HOST_ID,
        username: h.username,
        display_name: h.display_name,
        role: "host",
      };
    }
  }

  // --------------------------------------------------------------------------
  // DIRECT ID MATCH
  // --------------------------------------------------------------------------
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    const isHost = HOST_ID && String(directId) === String(HOST_ID);
    return {
      id: u.tiktok_id,
      username: u.username,
      display_name: u.display_name,
      role: isHost ? "host" : "speler",
    };
  }

  // --------------------------------------------------------------------------
  // UNIQUEID MATCH MET HOST (lowercase)
  // --------------------------------------------------------------------------
  if (un && HOST_USER && un === HOST_USER && HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  // --------------------------------------------------------------------------
  // HARDE FALLBACK NAAR HOST (consistent met server.ts)
  // --------------------------------------------------------------------------
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return {
      id: HOST_ID,
      username: h.username,
      display_name: h.display_name,
      role: "host",
    };
  }

  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

/* ============================================================================
   HEART ME
============================================================================ */

const HEART_ME_IDS = new Set([7934]);

function isHeartMeGift(evt: any) {
  const name = (evt.giftName || "").toLowerCase();
  return name === "heart me" || HEART_ME_IDS.has(Number(evt.giftId));
}

/* ============================================================================
   MAIN PROCESSOR
============================================================================ */

async function processGift(evt: any, source: string) {
  try {
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    await upsertIdentityFromLooseEvent(evt);

    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);

    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    const gid = getActiveGameId();
    const active = await isGameActive();

    const roundActive = (io as any).roundActive === true;
    const currentRound = (io as any).currentRound || 0;

    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const arena = getArena();

    const senderFmt = formatDisplay(sender);
    const receiverFmt = receiver.display_name;

    // Idle gifts → alleen host telt
    if (!gid || !active || !roundActive) {
      if (!isHostReceiver) {
        emitLog({
          type: "gift",
          message: `${senderFmt} → IDLE: ${evt.giftName} (+${diamonds}💎)`
        });
        return;
      }
    }

    // BP
    await addBP(
      BigInt(sender.tiktok_id),
      diamonds * 0.2,
      "GIFT",
      sender.display_name
    );

    // FAN
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(now() + 24 * 3600 * 1000);
      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1 WHERE tiktok_id=$2`,
        [expires, BigInt(sender.tiktok_id)]
      );

      emitLog({
        type: "fan",
        message: `${senderFmt} is nu FAN ❤️ (24u)`
      });
    }

    // TWIST
    const giftId = Number(evt.giftId);
    const twistType: TwistType | null =
      (Object.keys(TWIST_MAP) as TwistType[]).find(
        (t) => TWIST_MAP[t].giftId === giftId
      ) || null;

    if (twistType) {
      await addTwistByGift(String(sender.tiktok_id), twistType);
      emitLog({
        type: "twist",
        message: `${senderFmt} ontving twist: ${TWIST_MAP[twistType].giftName}`
      });
    }

    // ROUND SYNC INSERT
    const is_round_gift = !isHostReceiver && roundActive;
    const is_host_gift = isHostReceiver;

    await pool.query(
      `
      INSERT INTO gifts (
        giver_id, giver_username, giver_display_name,
        gift_name, diamonds, bp, created_at,
        receiver_id, receiver_username, receiver_display_name, receiver_role,
        game_id, is_host_gift, is_round_gift, arena_id, round_active,
        sender_display_name, sender_username, round_id, source_event
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,NOW(),
        $7,$8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,$19
      )
      `,
      [
        BigInt(sender.tiktok_id),
        sender.username,
        sender.display_name,

        evt.giftName || "unknown",
        diamonds,
        diamonds * 0.2,

        receiver.id ? BigInt(receiver.id) : null,
        receiver.username,
        receiver.display_name,
        receiver.role,

        gid,
        is_host_gift,
        is_round_gift,
        arena.round ?? null,
        roundActive,

        sender.display_name,
        sender.username,
        currentRound,
        source
      ]
    );

    await broadcastStats();
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();
    await emitArena();

    emitLog({
      type: "gift",
      message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${diamonds}💎)`
    });

  } catch (err) {
    console.error("❌ processGift ERROR:", err);
  }
}

/* ============================================================================
   INIT
============================================================================ */

export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: invalid connection");
    return;
  }

  console.log("🎁 GiftEngine v14.6 HOST NORMALIZATION PATCH LOADED");

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
  conn.on("giftMessage", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGift(d, "giftMessage");
  });
  conn.on("social", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGift(d, "social");
  });
}

export default {
  initGiftEngine,
  broadcastHostDiamonds,
};
