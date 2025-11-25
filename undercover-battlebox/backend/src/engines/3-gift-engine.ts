/* ============================================================================
   3-gift-engine.ts — v13.0
   FINAL VERSION — REALTIME DIAMONDS ENGINE
   ---------------------------------------
   ✔ Finale score = diamonds_total (altijd realtime)
   ✔ GEEN storeRoundDiamonds meer nodig
   ✔ players krijgen diamonds realtime in DB én arena
   ✔ sender krijgt GEEN diamonds (alleen BP)
   ✔ self-gift = host
   ✔ fallback receiver = host
   ✔ host gifts tellen in host leaderboard
   ✔ gifter leaderboard correct
   ✔ 100% dedupe safe
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
  broadcastHostDiamonds,
} from "../server";

import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";

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
    `SELECT id FROM games WHERE id=$1 AND status='running' LIMIT 1`,
    [gid]
  );

  return r.rows.length > 0;
}

/* ============================================================================
   DEDUPE (20s)
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
  if (!u) return "Onbekend";
  return u.display_name;
}

/* ============================================================================
   SENDER PARSER
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
      null,
  };
}

/* ============================================================================
   DIAMOND CALCULATION
============================================================================ */

function calcDiamonds(evt: any): number {
  const base = Number(evt.diamondCount || evt.diamond || 0);
  if (base <= 0) return 0;

  const repeat = Number(evt.repeatCount || 1);
  const final = !!evt.repeatEnd;
  const type = Number(evt.giftType || 0);

  // type=1 only on final
  if (type === 1) return final ? base * repeat : 0;

  return base;
}

/* ============================================================================
   RECEIVER RESOLUTION — FINAL VERSION
============================================================================ */

async function resolveReceiver(evt: any) {
  const host = getActiveHost();
  const HOST_ID = host?.id ? String(host.id) : null;
  const HOST_USERNAME = host?.username ? norm(host.username) : "";

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

  /* ---------------------------------------------------------
     1. Self gift → host
  --------------------------------------------------------- */
  if (evt.userId && directId && String(evt.userId) === String(directId)) {
    if (HOST_ID) {
      const h = await getOrUpdateUser(String(HOST_ID), null, null);
      return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
    }
  }

  /* ---------------------------------------------------------
     2. Direct ID receiver
  --------------------------------------------------------- */
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);

    // host?
    if (HOST_ID && String(directId) === String(HOST_ID))
      return { id: HOST_ID, username: u.username, display_name: u.display_name, role: "host" };

    return {
      id: u.tiktok_id,
      username: u.username,
      display_name: u.display_name,
      role: "speler",
    };
  }

  /* ---------------------------------------------------------
     3. Username fallback
  --------------------------------------------------------- */
  if (un) {
    if (HOST_USERNAME && un === HOST_USERNAME && HOST_ID) {
      const h = await getOrUpdateUser(HOST_ID, null, null);
      return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
    }
  }

  /* ---------------------------------------------------------
     4. Full fallback → HOST
  --------------------------------------------------------- */
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  /* ---------------------------------------------------------
     5. If nothing → dummy player
  --------------------------------------------------------- */
  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

/* ============================================================================
   HEART ME CHECK
============================================================================ */

const HEART_ME_GIFT_IDS = new Set([7934]);

function isHeartMeGift(evt: any): boolean {
  const name = (evt.giftName || "").toLowerCase().trim();
  if (name === "heart me") return true;
  return HEART_ME_GIFT_IDS.has(Number(evt.giftId));
}

/* ============================================================================
   MAIN PROCESSOR — v13 FINAL
============================================================================ */

async function processGift(evt: any, source: string) {
  try {
    /* -------------------- DEDUPE -------------------- */
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    /* -------------------- IDENTITY -------------------- */
    await upsertIdentityFromLooseEvent(evt);

    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);

    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    const gameId = getActiveGameId();
    const active = await isGameActive();

    if (!gameId || !active) {
      emitLog({
        type: "gift",
        message: `${sender.display_name} → UNKNOWN: ${evt.giftName} (+${diamonds}💎)`
      });
      return;
    }

    /* -------------------- RESOLVE RECEIVER -------------------- */
    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const receiverUser = receiver.id
      ? await getUserByTikTokId(String(receiver.id))
      : null;

    const senderFmt = formatDisplay(sender);
    const receiverFmt = receiverUser ? receiverUser.display_name : "UNKNOWN";

    /* -------------------- ROUND STATE -------------------- */
    const arena = getArena();
    const inRound =
      arena.status === "active" ||
      arena.status === "grace";

    /* =========================================================================
       1. SENDER GETS **NO DIAMONDS** — NEVER
       ======================================================================== */
    await addBP(
      BigInt(sender.tiktok_id),
      diamonds * 0.2,
      "GIFT",
      sender.display_name
    );

    /* =========================================================================
       2. PLAYER RECEIVES REALTIME DIAMONDS (DB + ARENA)
       ======================================================================== */
    if (!isHostReceiver && receiver.id && inRound) {
      // DB (realtime)
      await addDiamonds(BigInt(receiver.id), diamonds, "current_round");
      await addDiamonds(BigInt(receiver.id), diamonds, "total");

      // Arena (sorting only)
      await safeAddArenaDiamonds(String(receiver.id), diamonds);
    }

    /* =========================================================================
       3. HOST RECEIVES DIAMONDS (host leaderboard)
       ======================================================================== */
    if (isHostReceiver && receiver.id) {
      await addDiamonds(BigInt(receiver.id), diamonds, "total");
      await addDiamonds(BigInt(receiver.id), diamonds, "current_round");
    }

    /* =========================================================================
       4. FAN GIFT
       ======================================================================== */
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(now() + 24 * 3600 * 1000);

      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1 WHERE tiktok_id=$2`,
        [expires, BigInt(sender.tiktok_id)]
      );

      emitLog({
        type: "fan",
        message: `${sender.display_name} is nu FAN ❤️ (24u)`
      });
    }

    /* =========================================================================
       5. TWISTS
       ======================================================================== */
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

    /* =========================================================================
       6. INSERT GIFT (ALTIJD)
       ======================================================================== */
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
        !isHostReceiver && inRound,
        inRound,
        arena.round ?? 0
      ]
    );

    /* =========================================================================
       7. BROADCASTS
       ======================================================================== */
    await broadcastStats();
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();

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

  console.log("🎁 GiftEngine v13.0 LOADED");

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

export default {
  initGiftEngine,
  broadcastHostDiamonds,
};
