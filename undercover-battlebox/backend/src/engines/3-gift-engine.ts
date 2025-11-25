// ============================================================================
// 3-gift-engine.ts — v12.5 LEADERBOARD-PERFECT + HOST-DIAMONDS STREAM
// ============================================================================
// ✔ Spelers krijgen alleen diamonds wanneer ze ontvanger zijn
// ✔ Gifters krijgen 0 speler-diamonds (nooit meer player LB vervuiling)
// ✔ Host-diamonds worden perfect apart geteld via gifts.is_host_gift
// ✔ Realtime updates voor:
//      - Player leaderboard
//      - Gifter leaderboard
//      - Host diamonds totaal
//      - Stats
// ✔ Geen diamonds toevoegen aan sender (alleen BP blijft bestaan)
// ============================================================================

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

import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// GAME STATE HELPERS
// ============================================================================
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

// ============================================================================
// DEDUPLICATION
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
// HELPERS
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
// FAN EXPIRATION
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
// PARSERS
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
// RESOLVE RECEIVER — HOST LOCK
// ============================================================================
async function resolveReceiver(evt: any) {
  const active = getActiveHost();
  const HOST_ID = active?.id || null;
  const HOST_USERNAME = active?.username || "";

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

  // Direct host ID match
  if (HOST_ID && directId && String(directId) === String(HOST_ID)) {
    const h = await getOrUpdateUser(String(HOST_ID), null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  // Username match
  if (HOST_USERNAME && un === HOST_USERNAME) {
    const h = await getOrUpdateUser(String(HOST_ID), null, null);
    return { id: HOST_ID, username: h.username, display_name: h.display_name, role: "host" };
  }

  // Otherwise → user
  if (directId) {
    const u = await getOrUpdateUser(String(directId), null, null);
    return { id: u.tiktok_id, username: u.username, display_name: u.display_name, role: "speler" };
  }

  // Fallback → host
  if (HOST_ID) {
    const h = await getOrUpdateUser(String(HOST_ID), null, null);
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
// MAIN PROCESSOR — v12.5 PERFECT LEADERBOARD + HOST STREAM TELLING
// ============================================================================
async function processGift(evt: any, source: string) {
  try {
    // ----------------------------
    // DEDUPE
    // ----------------------------
    const key = makeDedupeKey(evt, source);
    if (dedupe.has(key)) return;
    dedupe.add(key);

    // ----------------------------
    // IDENTITEIT UPDATEN
    // ----------------------------
    await upsertIdentityFromLooseEvent(evt);

    const S = extractSender(evt);
    if (!S.id) return;

    const sender = await getOrUpdateUser(S.id, S.nick, S.unique);
    await cleanupFan(sender.tiktok_id);

    // ----------------------------
    // DIAMONDS
    // ----------------------------
    const diamonds = calcDiamonds(evt);
    if (diamonds <= 0) return;

    const gameId = getActiveGameId();
    const active = await isGameActive();

    // ----------------------------
    // GEEN ACTIEF SPEL → LOG ONLY
    // ----------------------------
    if (!gameId || !active) {
      emitLog({
        type: "gift",
        message: `${formatDisplay(sender)} → UNKNOWN: ${evt.giftName} (+${diamonds}💎)`
      });
      return;
    }

    // ----------------------------
    // RECEIVER
    // ----------------------------
    const receiver = await resolveReceiver(evt);
    const isHostReceiver = receiver.role === "host";

    const receiverUser = receiver.id
      ? await getUserByTikTokId(String(receiver.id))
      : null;

    if (receiverUser) {
      (receiverUser as any).is_host = isHostReceiver;
    }

    const senderFmt = formatDisplay(sender);
    const receiverFmt = formatDisplay(receiverUser);

    // ----------------------------
    // ARENA / ROUND
    // ----------------------------
    const arena = getArena();
    const nowMs = now();

    const inRound =
      (arena.status === "active" && nowMs <= arena.roundCutoff) ||
      (arena.status === "grace" && nowMs <= arena.graceEnd);

    const isRoundGift = inRound && !isHostReceiver;

    // ========================================================================
    // SENDER KRIJGT GEEN DIAMONDS MEER  ❗ (BELANGRIJKSTE FIX)
    // ========================================================================
    // Alleen BP (dus geen vervuiling player leaderboard)
    await addBP(
      BigInt(sender.tiktok_id),
      diamonds * 0.2,
      "GIFT",
      sender.display_name
    );

    // ========================================================================
    // SPELER ONTVANGT DIAMONDS (NIET HOST)
    // ========================================================================
    if (!isHostReceiver && receiver.id && isRoundGift) {
      // ronde diamonds
      await addDiamonds(BigInt(receiver.id), diamonds, "current_round");

      // total diamonds → nodig voor finale SOM
      await addDiamonds(BigInt(receiver.id), diamonds, "total");

      // Arena counters
      await safeAddArenaDiamonds(String(receiver.id), diamonds);
    }

    // ========================================================================
    // HOST ONTVANGT DIAMONDS
    // ========================================================================
    if (isHostReceiver && receiver.id) {
      await pool.query(
        `
        UPDATE users
        SET diamonds_stream = diamonds_stream + $1,
            diamonds_current_round = diamonds_current_round + $1,
            diamonds_total = diamonds_total + $1
        WHERE tiktok_id=$2
      `,
        [diamonds, BigInt(String(receiver.id))]
      );

      // Realtime host diamonds output
      broadcastHostDiamonds();
    }

    // ========================================================================
    // FAN GIFTS
    // ========================================================================
    if (isHostReceiver && isHeartMeGift(evt)) {
      const expires = new Date(nowMs + 24 * 3600 * 1000);
      await pool.query(
        `UPDATE users SET is_fan=TRUE, fan_expires_at=$1 WHERE tiktok_id=$2`,
        [expires, BigInt(sender.tiktok_id)]
      );

      emitLog({
        type: "fan",
        message: `${sender.display_name} is nu FAN ❤️ (24h)`
      });
    }

    // ========================================================================
    // TWIST GIFTS
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
        message: `${senderFmt} kreeg twist: ${TWIST_MAP[twistType].giftName}`
      });
    }

    // ========================================================================
    // LOGGEN IN GIFTS TABLE  (voeding voor leaderboards)
    // ========================================================================
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
        isRoundGift,
        arena.status === "active",
        Number(arena.round)
      ]
    );

    // ========================================================================
    // REALTIME UPDATES
    // ========================================================================
    await broadcastStats();
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();

    // ========================================================================
    // LOG
    // ========================================================================
    emitLog({
      type: "gift",
      message: `${senderFmt} → ${receiverFmt}: ${evt.giftName} (+${diamonds}💎)`
    });

  } catch (err) {
    console.error("❌ processGift ERROR:", err);
  }
  }

// ============================================================================
// REALTIME HOST DIAMOND STREAM
// ============================================================================
export async function broadcastHostDiamonds() {
  const active = getActiveHost();
  if (!active?.id) {
    io.emit("hostDiamonds", 0);
    return;
  }

  // Pak diamonds_stream uit users tabel
  const r = await pool.query(
    `
    SELECT COALESCE(diamonds_stream,0) AS total
    FROM users
    WHERE tiktok_id = $1
    `,
    [BigInt(active.id)]
  );

  const total = Number(r.rows[0]?.total || 0);

  io.emit("hostDiamonds", total);
}


// ============================================================================
// INIT — Sluizen voor alle gift-events
// ============================================================================
export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.log("⚠ initGiftEngine: no connection");
    return;
  }

  console.log("🎁 GiftEngine v12.5 LOADED — clean leaderboards + host total tracking");

  // raw TikTok connector events → funnel naar processGift()
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
// DEFAULT EXPORT
// ============================================================================
export default {
  initGiftEngine,
  broadcastHostDiamonds
};
