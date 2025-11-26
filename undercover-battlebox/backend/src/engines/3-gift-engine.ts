/* ============================================================================
   3-gift-engine.ts — v14.0
   GIFTS-ONLY ARCHITECTURE (NO USER DIAMOND COLUMNS)
   -------------------------------------------------
   ✔ Alle diamonds worden ALLEEN opgeslagen in `gifts`
   ✔ Player gifts → receiver_role='speler'
   ✔ Host gifts → receiver_role='host'
   ✔ Self-gifts → automatisch host
   ✔ Geen diamonds meer in users-table
   ✔ Geen race conditions
   ✔ Geen dubbele diamond updates
   ✔ Arena gebruikt realtime aggregation uit gifts
   ✔ Leaderboards gebruiken realtime SUM(diamonds)
==============================================================================*/

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

import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

/* ============================================================================ */
/* GAME HELPERS */
/* ============================================================================ */

function getActiveGameId(): number | null {
  const id = (io as any)?.currentGameId;
  return typeof id === "number" ? id : null;
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

/* ============================================================================ */
/* DEDUPE */
/* ============================================================================ */

const dedupe = new Set<string>();
setInterval(() => dedupe.clear(), 10000);

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
/* PARSERS */
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

/* ============================================================================ */
/* DIAMONDS */
/* ============================================================================ */

function calcDiamonds(evt: any): number {
  const base = Number(evt.diamondCount || evt.diamond || 0);
  if (base <= 0) return 0;

  const repeat = Number(evt.repeatCount || 1);
  const final = !!evt.repeatEnd;
  const type = Number(evt.giftType || 0);

  // type=1 → only final
  if (type === 1) return final ? base * repeat : 0;

  return base;
}

/* ============================================================================ */
/* RECEIVER RESOLUTION */
/* ============================================================================ */

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

  const username =
    evt.receiver?.uniqueId ||
    evt.receiver?.unique_id ||
    evt.toUser?.uniqueId ||
    evt.toUser?.unique_id ||
    null;

  const un = username ? norm(username) : null;

  /* ---------------- SELF-GIFT = HOST ---------------- */
  if (evt.userId && directId && String(evt.userId) === String(directId)) {
    if (!HOST_ID) return null;

    const h = await getOrUpdateUser(HOST_ID, null, null);

    return {
      id: HOST_ID,
      role: "host",
      username: h.username,
      display_name: h.display_name,
    };
  }

  /* ---------------- DIRECT ID ---------------- */
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    const isHost = HOST_ID && String(directId) === String(HOST_ID);

    return {
      id: String(u.tiktok_id),
      role: isHost ? "host" : "speler",
      username: u.username,
      display_name: u.display_name,
    };
  }

  /* ---------------- USERNAME FALLBACK ---------------- */
  if (un && HOST_USERNAME && un === HOST_USERNAME && HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);

    return {
      id: HOST_ID,
      role: "host",
      username: h.username,
      display_name: h.display_name,
    };
  }

  /* ---------------- DEFAULT → HOST ---------------- */
  if (HOST_ID) {
    const h = await getOrUpdateUser(HOST_ID, null, null);

    return {
      id: HOST_ID,
      role: "host",
      username: h.username,
      display_name: h.display_name,
    };
  }

  return null;
}

/* ============================================================================ */
/* MAIN PROCESSOR */
/* ============================================================================ */

async function processGift(evt: any, source: string) {
  try {
    /* ---------------- DEDUPE ---------------- */
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    /* ---------------- IDENTITY ---------------- */
    await upsertIdentityFromLooseEvent(evt);

    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);

    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    const gameId = getActiveGameId();
    const active = await isGameActive();
    if (!gameId || !active) return;

    /* ---------------- RESOLVE RECEIVER ---------------- */
    const receiver = await resolveReceiver(evt);
    if (!receiver || !receiver.id) return;

    const arena = getArena();
    const inRound = arena.status === "active" || arena.status === "grace";

    /* ---------------- ROUND ID ---------------- */
    const roundId = arena.round ?? 0;

    /* ---------------- ARENA (visual only) ---------------- */
    if (receiver.role === "speler" && inRound) {
      await safeAddArenaDiamonds(receiver.id, diamonds);
    }

    /* ---------------- TWISTS ---------------- */
    const giftId = Number(evt.giftId);
    const twist = (Object.keys(TWIST_MAP) as TwistType[]).find(
      (t) => TWIST_MAP[t].giftId === giftId
    );
    if (twist) await addTwistByGift(String(sender.tiktok_id), twist);

    /* ---------------- INSERT GIFT (ALWAYS) ---------------- */
    await pool.query(
      `
      INSERT INTO gifts (
        giver_id, giver_username, giver_display_name,
        receiver_id, receiver_username, receiver_display_name, receiver_role,
        gift_name, diamonds,
        game_id, round_id,
        source_event, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      `,
      [
        BigInt(sender.tiktok_id),
        sender.username,
        sender.display_name,

        BigInt(receiver.id),
        receiver.username,
        receiver.display_name,
        receiver.role,

        evt.giftName || "unknown",
        diamonds,

        gameId,
        roundId,

        source,
      ]
    );

    /* ---------------- BROADCASTS ---------------- */
    await broadcastStats();
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();

    emitLog({
      type: "gift",
      message: `${sender.display_name} → ${receiver.display_name}: ${evt.giftName} (${diamonds}💎)`
    });

  } catch (err) {
    console.error("❌ processGift ERROR:", err);
  }
}

/* ============================================================================ */
/* INIT */
/* ============================================================================ */

export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") return;

  console.log("🎁 GiftEngine v14 LOADED");

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

export default { initGiftEngine };
