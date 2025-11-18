// ============================================================================
// 3-gift-engine.ts — v4.7 COMPACT-FULL (Danny Build)
// ============================================================================
//
// ✔ Zelfde logica als v4.4
// ✔ Host-detectie FIX
// ✔ Compactere logs
// ✔ Geen RAW-dump spam
// ✔ Fallback gift handlers intact
// ✔ Twist-integratie
// ✔ BigInt safe
//
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";
import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// Helpers
// ============================================================================

function getCurrentGameSessionId(): number | null {
  return (io as any).currentGameId ?? null;
}

function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

let HOST_USERNAME_CACHE = "";

export async function initDynamicHost() {
  await refreshHostUsername();
}

export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = h.trim().replace("@", "").toLowerCase();
  console.log("🔄 HOST UPDATED:", HOST_USERNAME_CACHE || "(none)");
}

// Duplicate preventie
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// Minimal user-change debugger
const debugUserCache = new Map<string, { display_name: string; username: string }>();

// ============================================================================
// Receiver resolver
// ============================================================================

async function resolveReceiver(event: any) {
  const hostRaw = HOST_USERNAME_CACHE;

  const eventId =
    event.receiverUserId ||
    event.toUserId ||
    event.toUser?.userId ||
    event.receiver?.userId ||
    null;

  const uniqueRaw = event.toUser?.uniqueId || event.receiver?.uniqueId || null;
  const nickRaw = event.toUser?.nickname || event.receiver?.nickname || null;

  const uniqueNorm = uniqueRaw ? norm(uniqueRaw) : null;
  const nickNorm = nickRaw ? norm(nickRaw) : null;

  // host via uniqueId exact match
  if (uniqueNorm && hostRaw && uniqueNorm === hostRaw) {
    return {
      id: null,
      username: hostRaw,
      display_name: uniqueRaw,
      role: "host" as const,
    };
  }

  // nickname bevat host naam
  if (nickNorm && hostRaw && nickNorm.includes(hostRaw)) {
    return {
      id: null,
      username: hostRaw,
      display_name: nickRaw,
      role: "host" as const,
    };
  }

  // lookup via eventId
  if (eventId) {
    const tiktokIdStr = String(eventId);

    const r = await getOrUpdateUser(
      tiktokIdStr,
      nickRaw || null,
      uniqueRaw || null
    );

    // detecteer naamswijziging → compact log
    const prev = debugUserCache.get(tiktokIdStr);
    if (!prev || prev.display_name !== r.display_name || prev.username !== r.username) {
      debugUserCache.set(tiktokIdStr, {
        display_name: r.display_name,
        username: r.username,
      });
      console.log(
        `👤 Update user: ${tiktokIdStr} -> ${r.display_name} (@${r.username})`
      );
    }

    if (hostRaw && norm(r.username) === hostRaw) {
      return {
        id: r.id,
        username: r.username,
        display_name: r.display_name,
        role: "host" as const,
      };
    }

    return {
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      role: "speler" as const,
    };
  }

  // fallback host
  if (hostRaw) {
    return {
      id: null,
      username: hostRaw,
      display_name: hostRaw,
      role: "host" as const,
    };
  }

  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler" as const,
  };
}

// ============================================================================
// FAN 24h
// ============================================================================

async function activateFan(userId: bigint) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `
    UPDATE users
    SET is_fan = true,
        fan_expires_at = $1
    WHERE tiktok_id = $2
    `,
    [expires, userId]
  );
}

// ============================================================================
// Core gift processing
// ============================================================================

async function processGiftEvent(data: any, source: string) {
  // compact debug
  console.log(`💠 Gift event [${source}] giftId=${data.giftId} diamonds=${data.diamondCount}`);

  // dedup
  const msgId =
    data.msgId ?? data.id ?? data.logId ?? `${source}-${data.giftId}-${Date.now()}`;
  const msgKey = String(msgId);

  if (processedMsgIds.has(msgKey)) {
    console.log(`⏭️ duplicate gift ignored`);
    return;
  }
  processedMsgIds.add(msgKey);

  try {
    // sender
    const senderId =
      data.user?.userId ||
      data.sender?.userId ||
      data.userId ||
      data.senderUserId;

    if (!senderId) {
      console.log("⚠️ No senderId — skip");
      return;
    }

    const sender = await getOrUpdateUser(
      String(senderId),
      data.user?.nickname || data.sender?.nickname || null,
      data.user?.uniqueId || data.sender?.uniqueId || null
    );

    const credited = calcDiamonds(data);
    if (credited <= 0) return;

    const receiver = await resolveReceiver(data);
    const isHost = receiver.role === "host";

    console.log(
      `🎁 ${sender.display_name} → ${receiver.display_name} (${data.giftName}) +${credited}💎`
    );

    const gameId = getCurrentGameSessionId();
    const arena = getArena();
    const now = Date.now();

    const inActive = arena.status === "active" && now <= arena.roundCutoff;
    const inGrace = arena.status === "grace" && now <= arena.graceEnd;
    const inRound = inActive || inGrace;

    // credits altijd op sender
    await addDiamonds(BigInt(senderId), credited, "total");
    await addDiamonds(BigInt(senderId), credited, "stream");
    await addDiamonds(BigInt(senderId), credited, "current_round");

    const bpGain = credited * 0.2;
    await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

    // arena diamonds
    if (!isHost && receiver.id && inRound) {
      await safeAddArenaDiamonds(receiver.id.toString(), credited);
    }

    // twist match
    const giftId = Number(data.giftId);
    let twistType: TwistType | null = null;

    for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
      if (TWIST_MAP[key].giftId === giftId) twistType = key;
    }

    if (twistType) {
      await addTwistByGift(String(senderId), twistType);
      console.log(`🌀 Twist: ${sender.display_name} → ${TWIST_MAP[twistType].giftName}`);
      emitLog({
        type: "twist",
        message: `${sender.display_name} kreeg twist: ${TWIST_MAP[twistType].giftName}`,
      });
    }

    // fanclub (Heart Me)
    if (
      isHost &&
      (data.giftName?.toLowerCase() === "heart me" || data.giftId === 5655)
    ) {
      await activateFan(BigInt(senderId));
      console.log(`❤️ FAN24H: ${sender.display_name}`);
      emitLog({
        type: "gift",
        message: `${sender.display_name} → FAN 24h ❤️`,
      });
    }

    // save DB
    await pool.query(
      `
        INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name,
          receiver_role, gift_name, diamonds, bp, game_id, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      `,
      [
        BigInt(senderId),
        sender.username,
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

    emitLog({
      type: "gift",
      message: `${sender.display_name} → ${receiver.display_name}: ${data.giftName} (${credited}💎)`,
    });
  } catch (err: any) {
    console.error("❌ GiftEngine error:", err?.message || err);
  }
}

// Diamonds berekenen — identiek aan oude engine
function calcDiamonds(data: any): number {
  const rawDiamonds = Number(data.diamondCount || data.diamond || 0);
  if (rawDiamonds <= 0) return 0;

  const repeat = Number(data.repeatCount || 1);
  const repeatEnd = !!data.repeatEnd;
  const giftType = Number(data.giftType || 0);

  return giftType === 1
    ? repeatEnd
      ? rawDiamonds * repeat
      : 0
    : rawDiamonds;
}

// ============================================================================
// GIFT ENGINE INIT — compacte, volledige versie
// ============================================================================

export function initGiftEngine(conn: any) {
  if (!conn) {
    console.warn("⚠ initGiftEngine zonder verbinding → IDLE-modus");
    return;
  }

  if (typeof conn.on !== "function") {
    console.warn("⚠ initGiftEngine: conn mist .on() → IDLE");
    return;
  }

  console.log("🎁 GiftEngine v4.7 actief");

  // Minimal debugging van inkomende event types (niet spammen)
  if (typeof conn.onAny === "function") {
    let debugCount = 0;

    conn.onAny((eventName: string, eventData: any) => {
      if (debugCount < 10) {
        console.log(
          `📡 ${eventName}`,
          `giftId=${eventData?.giftId ?? "-"}`
        );
        debugCount++;
      }
    });
  }

  // Standaard gift-event
  conn.on("gift", async (data: any) => {
    await processGiftEvent(data, "gift");
  });

  // Fallback: sommige libs sturen gifts via roomMessage
  conn.on("roomMessage", async (data: any) => {
    if (data?.giftId || data?.diamondCount) {
      await processGiftEvent(data, "roomMessage");
    }
  });

  // Fallback: gift via "member"
  conn.on("member", async (data: any) => {
    if (data?.giftId || data?.diamondCount) {
      await processGiftEvent(data, "member");
    }
  });

  // Ultieme fallback: gift data verstopt in chat._data
  conn.on("chat", (msg: any) => {
    if (msg?._data?.giftId || msg?._data?.diamondCount) {
      processGiftEvent(msg._data, "chat-hidden");
    }
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initGiftEngine,
  initDynamicHost,
  refreshHostUsername,
};
