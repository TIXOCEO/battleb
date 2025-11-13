
// src/engines/3-gift-engine.ts — BattleBox Gift Engine v1.0
// - Host wordt opgehaald uit database (settings.host_username)
// - 100% match via: event → DB → fallback
// - Geen Unknowns
// - Streak-safe
// - Massive debug mode via GIFT_DEBUG=true

import pool from "../db";
import { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

const DEBUG = process.env.GIFT_DEBUG === "true";

function dlog(...a: any[]) {
  if (DEBUG) console.log("[GIFT-DEBUG]", ...a);
}

function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// Cache host username every 5 seconds
let cachedHost = "";
let lastHostLoad = 0;

async function getHost(): Promise<string> {
  const now = Date.now();
  if (now - lastHostLoad > 5000) {
    cachedHost = (await getSetting("host_username")) || "";
    lastHostLoad = now;
    dlog("🔄 Host refreshed from DB:", cachedHost);
  }
  return cachedHost;
}

// DEDUP
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60000);

// =======================================================================
// RECEIVER RESOLVE
// =======================================================================

async function resolveReceiver(event: any) {
  const host = await getHost();
  const hostNorm = norm(host);

  if (!hostNorm) {
    console.error("❌ FATAL: host_username ontbreekt in settings!");
  }

  // RAW EVENT
  const eventId =
    event.receiverUserId ||
    event.toUserId ||
    event.toUser?.userId ||
    event.receiver?.userId ||
    null;

  const uniqueNorm = norm(
    event.toUser?.uniqueId ||
      event.receiver?.uniqueId ||
      event.receiverUniqueId
  );

  const nickNorm = norm(
    event.toUser?.nickname ||
      event.receiver?.nickname ||
      event.toUser?.displayName
  );

  dlog("── resolveReceiver ──");
  dlog("Host =", hostNorm);
  dlog("eventId =", eventId);
  dlog("uniqueNorm =", uniqueNorm);
  dlog("nickNorm =", nickNorm);

  // 1) Direct uniqueId match
  if (uniqueNorm && uniqueNorm === hostNorm) {
    dlog("➡ MATCH: uniqueId == HOST");
    return {
      id: null,
      username: host,
      display_name: host,
      role: "host",
    };
  }

  // 2) Nickname contains host
  if (nickNorm && nickNorm.includes(hostNorm)) {
    dlog("➡ MATCH: nickname contains host");
    return {
      id: null,
      username: host,
      display_name:
        event.toUser?.nickname ||
        event.receiver?.nickname ||
        host,
      role: "host",
    };
  }

  // 3) DB lookup fallback
  if (eventId) {
    const r = await getOrUpdateUser(
      String(eventId),
      event.toUser?.nickname || event.receiver?.nickname,
      event.toUser?.uniqueId || event.receiver?.uniqueId
    );

    dlog("DB result =", {
      id: r.id,
      username: r.username,
      display: r.display_name,
      norm: norm(r.username),
    });

    if (norm(r.username) === hostNorm) {
      dlog("➡ MATCH: database username == HOST");
      return {
        id: r.id,
        username: r.username.replace(/^@/, ""),
        display_name: r.display_name,
        role: "host",
      };
    }

    dlog("➡ NOT HOST → speler");
    return {
      id: r.id,
      username: r.username.replace(/^@/, ""),
      display_name: r.display_name,
      role: "speler",
    };
  }

  // 4) Unknown event data → assume host
  dlog("❗ Geen receiver-info → fallback to HOST");
  return {
    id: null,
    username: host,
    display_name: host,
    role: "host",
  };
}

// =======================================================================
// INIT GIFT ENGINE
// =======================================================================

export function initGiftEngine(conn: any) {
  console.log("[GIFT ENGINE] v1.0 LOADED — DB-driven host detection");

  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // SENDER
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId
      )?.toString();

      if (!senderId) return;

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsername = sender.username.replace(/^@+/, "");

      // VALUE
      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      const giftType = Number(data.giftType || 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeat = Number(data.repeatCount || 1);

      let credited =
        giftType === 1
          ? repeatEnd
            ? rawDiamonds * repeat
            : 0
          : rawDiamonds;

      if (credited <= 0) return;
      processedMsgIds.add(msgId);

      // RESOLVE RECEIVER
      const receiver = await resolveReceiver(data);
      const isHost = receiver.role === "host";

      // GAME STATE
      const gameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();

      const inActive =
        arena.status === "active" && now <= arena.roundCutoff;

      const inGrace =
        arena.status === "grace" && now <= arena.graceEnd;

      const inRound = inActive || inGrace;

      // LOGICA
      if (!isHost && !inRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${data.giftName} → ${receiver.display_name}`,
        });
        return;
      }

      if (isHost && !gameId) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Geen actief spel → host gift genegeerd`,
        });
        return;
      }

      // UPDATE PUNTEN
      await addDiamonds(BigInt(senderId), credited, "total");
      await addDiamonds(BigInt(senderId), credited, "stream");
      await addDiamonds(BigInt(senderId), credited, "current_round");

      const bpGain = credited * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      if (!isHost && receiver.id && inRound) {
        if (arena.players.some((p: any) => p.id === receiver.id)) {
          await addDiamondsToArenaPlayer(receiver.id, credited);
        }
      }

      // SAVE DATABASE
      await pool.query(
        `
      INSERT INTO gifts (
        giver_id, giver_username, giver_display_name,
        receiver_id, receiver_username, receiver_display_name,
        receiver_role,
        gift_name, diamonds, bp, game_id, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    `,
        [
          BigInt(senderId),
          senderUsername,
          sender.display_name,
          receiver.id ? BigInt(receiver.id) : null,
          receiver.username,
          receiver.display_name,
          receiver.role,
          data.giftName || "unknown",
          credited,
          bpGain,
          gameId,
        ]
      );

      // LOG
      const receiverLabel = isHost
        ? `${receiver.display_name} [HOST]`
        : `${receiver.display_name} (@${receiver.username})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsername}) → ${receiverLabel}: ${data.giftName} (${credited}💎${
          repeat > 1 ? ` x${repeat}` : ""
        })`,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });
}
