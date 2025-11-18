// ============================================================================
// 3-gift-engine.ts — v4.8 (Host-ID Perfect, Compact Logs, Upgrade Detection)
// Undercover BattleBox — Gift + Twist Engine
// ============================================================================
//
// Fixes & Features:
// ✔ Host-detectie via host_id én host_username
// ✔ Unknown→Known updates → emitLog + console
// ✔ Compact logs, geen RAW spam
// ✔ Twist-integratie 100% intact
// ✔ Arena diamonds logic intact
// ✔ Fan Club (HeartMe → 24h)
// ✔ BigInt-safe
// ✔ Geen duplicates
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
let HOST_ID_CACHE: string | null = null;

// ============================================================================
// Host cache refresh
// ============================================================================
export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = h.trim().replace("@", "").toLowerCase();

  HOST_ID_CACHE = await getSetting("host_id");

  console.log(
    `🔄 HOST REFRESH → username=@${HOST_USERNAME_CACHE || "-"} | id=${HOST_ID_CACHE || "-"}`
  );
}

export async function initDynamicHost() {
  await refreshHostUsername();
}

// ============================================================================
// Duplicate control
// ============================================================================
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// Minimal user debugger
const debugUserCache = new Map<
  string,
  { display_name: string; username: string }
>();

// ============================================================================
// Receiver resolver — nu met host_id matching
// ============================================================================
async function resolveReceiver(event: any) {
  const hostRaw = HOST_USERNAME_CACHE;
  const hostId = HOST_ID_CACHE;

  // Echte TikTok receiverId’s
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

  // --------------------------------------------------------------------------
  // 1) Match op host_id → zawsze host
  // --------------------------------------------------------------------------
  if (hostId && eventId && String(eventId) === hostId) {
    return {
      id: hostId,
      username: hostRaw,
      display_name: nickRaw || uniqueRaw || hostRaw,
      role: "host" as const,
    };
  }

  // --------------------------------------------------------------------------
  // 2) Match op uniqueId
  // --------------------------------------------------------------------------
  if (uniqueNorm && hostRaw && uniqueNorm === hostRaw) {
    return {
      id: hostId,
      username: hostRaw,
      display_name: uniqueRaw,
      role: "host" as const,
    };
  }

  // --------------------------------------------------------------------------
  // 3) Match op nickname bevat hostnaam
  // --------------------------------------------------------------------------
  if (nickNorm && hostRaw && nickNorm.includes(hostRaw)) {
    return {
      id: hostId,
      username: hostRaw,
      display_name: nickRaw,
      role: "host" as const,
    };
  }

  // --------------------------------------------------------------------------
  // 4) Geen match → speler lookup
  // --------------------------------------------------------------------------
  if (eventId) {
    const tiktokIdStr = String(eventId);

    const r = await getOrUpdateUser(
      tiktokIdStr,
      nickRaw || null,
      uniqueRaw || null
    );

    // Detecteer updates
    const prev = debugUserCache.get(tiktokIdStr);
    if (!prev || prev.display_name !== r.display_name || prev.username !== r.username) {
      debugUserCache.set(tiktokIdStr, {
        display_name: r.display_name,
        username: r.username,
      });

      emitLog({
        type: "user",
        message: `User update: ${tiktokIdStr} → ${r.display_name} (@${r.username})`,
      });

      console.log(
        `👤 User update: ${tiktokIdStr} → ${r.display_name} (@${r.username})`
      );
    }

    // Deze speler blijkt de host te zijn?
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

  // --------------------------------------------------------------------------
  // 5) Fallback op hostRaw
  // --------------------------------------------------------------------------
  if (hostRaw) {
    return {
      id: hostId,
      username: hostRaw,
      display_name: hostRaw,
      role: "host" as const,
    };
  }

  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler",
  };
}

// ============================================================================
// Fan 24h
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
// Diamonds berekenen (exact oude logic)
// ============================================================================
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
// Core gift processor
// ============================================================================
async function processGiftEvent(data: any, source: string) {
  console.log(`💠 Gift [${source}] id=${data.giftId} 💎=${data.diamondCount}`);

  // Dedupe
  const msgId =
    data.msgId ?? data.id ?? data.logId ?? `${source}-${data.giftId}-${Date.now()}`;
  const key = String(msgId);

  if (processedMsgIds.has(key)) return;
  processedMsgIds.add(key);

  try {
    // Sender
    const senderId =
      data.user?.userId ||
      data.sender?.userId ||
      data.userId ||
      data.senderUserId;

    if (!senderId) return;

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

    // Diamonds
    await addDiamonds(BigInt(senderId), credited, "total");
    await addDiamonds(BigInt(senderId), credited, "stream");
    await addDiamonds(BigInt(senderId), credited, "current_round");

    const bpGain = credited * 0.2;
    await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

    // Arena diamonds voor spelers
    if (!isHost && receiver.id && inRound) {
      await safeAddArenaDiamonds(receiver.id.toString(), credited);
    }

    // Twist detect
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
        message: `${sender.display_name} kreeg twist ${TWIST_MAP[twistType].giftName}`,
      });
    }

    // FanClub HeartMe
    if (
      isHost &&
      (data.giftName?.toLowerCase() === "heart me" || data.giftId === 5655)
    ) {
      await activateFan(BigInt(senderId));
      console.log(`❤️ FAN 24H → ${sender.display_name}`);
      emitLog({
        type: "gift",
        message: `${sender.display_name} → FAN 24h ❤️`,
      });
    }

    // Save in DB
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

// ============================================================================
// INIT
// ============================================================================
export function initGiftEngine(conn: any) {
  if (!conn || typeof conn.on !== "function") {
    console.warn("⚠ initGiftEngine zonder geldige verbinding");
    return;
  }

  console.log("🎁 GiftEngine v4.8 actief");

  // Kleine debug van inkomende events
  if (typeof conn.onAny === "function") {
    let dbg = 0;
    conn.onAny((ev: string, data: any) => {
      if (dbg < 8) {
        console.log(`📡 ${ev} giftId=${data?.giftId ?? "-"}`);
        dbg++;
      }
    });
  }

  conn.on("gift", (d: any) => processGiftEvent(d, "gift"));
  conn.on("roomMessage", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGiftEvent(d, "roomMessage");
  });
  conn.on("member", (d: any) => {
    if (d?.giftId || d?.diamondCount) processGiftEvent(d, "member");
  });
  conn.on("chat", (msg: any) => {
    if (msg?._data?.giftId || msg?._data?.diamondCount)
      processGiftEvent(msg._data, "chat-hidden");
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
