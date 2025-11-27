/* ============================================================================
   3-gift-engine.ts — v15.0
   GIFTS ENGINE — FIXED FOR ROUND-BASED SCORING (BattleBox v15)
   ------------------------------------------------------------
   ✔ round_id=0 buiten ronde
   ✔ Alleen gifts tijdens active/grace tellen mee
   ✔ game_id altijd opgeslagen
   ✔ Finale baseline via round_id opvragen door game-engine
   ✔ arena_id = current_round (of 0)
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

import { addBP } from "./4-points-engine";
import { getArena, emitArena } from "./5-game-engine";

import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

/* ============================================================================ */
/* GAME ID / ACTIVE GAME */
/* ============================================================================ */

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

/* ============================================================================ */
/* DEDUPE */
/* ============================================================================ */

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

/* ============================================================================ */
/* HELPERS */
/* ============================================================================ */

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

function extractSender(evt: any) {
  const u =
    evt?.user ||
    evt?.sender ||
    evt?.userIdentity ||
    evt?.fromUser ||
    evt?.profile ||
    evt;

  const id = u?.userId || evt?.userId || null;
  const unique = norm(u?.uniqueId || evt?.uniqueId || "");
  const nick = u?.nickname || unique;

  return {
    id,
    unique,
    nick,
  };
}

function calcDiamonds(evt: any): number {
  return (
    Number(evt?.diamondCount) ||
    Number(evt?.repeatCount * evt?.diamondCost) ||
    Number(evt?.giftDiamondCount) ||
    0
  );
}

function isHeartMeGift(evt: any): boolean {
  const name =
    evt?.giftName?.toLowerCase?.() ||
    evt?.name?.toLowerCase?.() ||
    "";

  return name.includes("heart me") || name.includes("hartje");
}

async function resolveReceiver(evt: any) {
  const host = getActiveHost();
  if (!host) {
    return {
      id: null,
      username: "",
      display_name: "",
      role: "speler",
    };
  }

  const senderId = String(
    evt?.user?.userId ||
    evt?.sender?.userId ||
    evt?.userId
  );

  if (!senderId || senderId === host.id) {
    return {
      id: host.id,
      username: host.username,
      display_name: host.display_name,
      role: "host",
    };
  }

  return {
    id: senderId,
    username: norm(evt?.user?.uniqueId || evt?.uniqueId || ""),
    display_name: evt?.user?.nickname || evt?.nickname || "",
    role: "speler",
  };
}

/* ============================================================================ */
/* MAIN GIFT PROCESSOR */
/* ============================================================================ */

async function processGift(evt: any, source: string) {
  try {
    /* ----- DEDUPE ----- */
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    /* ----- IDENTITY SYNC ----- */
    await upsertIdentityFromLooseEvent(evt);

    /* ----- SENDER ----- */
    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);

    /* ----- DIAMONDS ----- */
    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    /* ----- GAME ACTIVE? ----- */
    const gameId = getActiveGameId();
    const active = await isGameActive();

    if (!gameId || !active) {
      emitLog({
        type: "gift",
        message: `${sender.display_name} → UNKNOWN: ${evt.giftName} (+${diamonds}💎)`
      });
      return;
    }

    /* ----- RECEIVER ----- */
    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const receiverUser = receiver.id
      ? await getUserByTikTokId(String(receiver.id))
      : null;

    const senderFmt = sender.display_name;
    const receiverFmt = receiverUser ? receiverUser.display_name : "UNKNOWN";

    /* ----- ARENA CONTEXT ----- */
    const arena = getArena();
    const inRound = arena.status === "active" || arena.status === "grace";

    const roundId = inRound ? arena.round : 0;
    const arena_id = roundId;

    /* ----- ADD BP ----- */
    await addBP(
      BigInt(sender.tiktok_id),
      diamonds * 0.2,
      "GIFT",
      sender.display_name
    );

    /* ----- FAN HEART ME ----- */
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(now() + 24 * 3600 * 1000);

      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1
         WHERE tiktok_id=$2`,
        [expires, BigInt(sender.tiktok_id)]
      );

      emitLog({
        type: "fan",
        message: `${sender.display_name} is nu FAN ❤️ (24u)`
      });
    }

    /* ----- TWISTS ----- */
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

    /* ========================================================================
       INSERT GIFT ROW
    ======================================================================== */
    await pool.query(
      `
      INSERT INTO gifts (
        giver_id,
        giver_username,
        giver_display_name,

        gift_name,
        diamonds,
        bp,
        created_at,

        receiver_id,
        receiver_username,
        receiver_display_name,
        receiver_role,

        game_id,
        is_host_gift,
        is_round_gift,
        arena_id,
        round_active,

        sender_display_name,
        sender_username,
        round_id,
        source_event
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

        receiver.id ? BigInt(String(receiver.id)) : null,
        receiver.username,
        receiver.display_name,
        receiver.role,

        gameId,
        isHostReceiver,
        (!isHostReceiver && inRound),
        arena_id,
        inRound,

        sender.display_name,
        sender.username,
        roundId,

        source
      ]
    );

    /* ========================================================================
       REALTIME UPDATES
    ======================================================================== */

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

/* ============================================================================ */
/* INIT ENGINE */
/* ============================================================================ */

export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: invalid connection");
    return;
  }

  console.log(
    "🎁 GiftEngine v15.0 LOADED (round-based scoring • no idle scoring • 21-col DB)"
  );

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
