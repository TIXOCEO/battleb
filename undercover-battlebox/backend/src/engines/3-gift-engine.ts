// ============================================================================
// 3-gift-engine.ts — v4.2 (Danny Stable Build)
// ============================================================================
//
// ✔ Twist-integratie (Galaxy, MoneyGun, Bomb, Immune, Heal, Diamond Pistol)
// ✔ Gift → twist mapping via giftId uit twist-definitions
// ✔ Support voor non-twist gifts (BP & diamonds)
// ✔ Host-only HeartMe → Fan 24h
// ✔ BigInt-safe
// ✔ Game boundaries correct
// ✔ No duplicates (msgId-ratelimiter)
// ✔ Stable matcher met display_name en raw username
//
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io } from "../server";

import {
  TWIST_MAP,
  TwistType,
} from "./twist-definitions";

import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// HELPER: GAME SESSION ID (SAFE)
// ============================================================================
function getCurrentGameSessionId(): number | null {
  // @ts-ignore patched in server.ts
  return io.currentGameId ?? null;
}

// ============================================================================
// NORMALIZER
// ============================================================================
function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// ============================================================================
// HOST CACHE
// ============================================================================
let HOST_USERNAME_CACHE = "";

export async function initDynamicHost() {
  await refreshHostUsername();
}

export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = h.trim().replace("@", "").toLowerCase();
  console.log("🔄 HOST UPDATED:", HOST_USERNAME_CACHE || "(none)");
}

// ============================================================================
// DUPLICATE FILTER
// ============================================================================
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// ============================================================================
// RECEIVER RESOLVER
// ============================================================================
async function resolveReceiver(event: any) {
  const hostRaw = HOST_USERNAME_CACHE;

  const eventId =
    event.receiverUserId ||
    event.toUserId ||
    event.toUser?.userId ||
    event.receiver?.userId ||
    null;

  const uniqueRaw =
    event.toUser?.uniqueId ||
    event.receiver?.uniqueId ||
    event.receiverUniqueId ||
    null;

  const nickRaw =
    event.toUser?.nickname ||
    event.receiver?.nickname ||
    null;

  const uniqueNorm = uniqueRaw ? norm(uniqueRaw) : null;
  const nickNorm = nickRaw ? norm(nickRaw) : null;

  if (uniqueNorm && hostRaw && uniqueNorm === hostRaw) {
    return { id: null, username: hostRaw, display_name: uniqueRaw, role: "host" };
  }

  if (nickNorm && hostRaw && nickNorm.includes(hostRaw)) {
    return { id: null, username: hostRaw, display_name: nickRaw, role: "host" };
  }

  if (eventId) {
    const r = await getOrUpdateUser(
      String(eventId),
      nickRaw || null,
      uniqueRaw || null
    );

    if (hostRaw && norm(r.username) === hostRaw) {
      return {
        id: r.id,
        username: r.username.replace(/^@/, ""),
        display_name: r.display_name,
        role: "host",
      };
    }

    return {
      id: r.id,
      username: r.username.replace(/^@/, ""),
      display_name: r.display_name,
      role: "speler",
    };
  }

  if (hostRaw) {
    return { id: null, username: hostRaw, display_name: hostRaw, role: "host" };
  }

  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler",
  };
}

// ============================================================================
// FANCLUB 24H — heart me gift
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
// GIFT ENGINE
// ============================================================================
export function initGiftEngine(conn: any) {
  console.log("🎁 GIFT ENGINE v4.2 LOADED WITH TWISTS");

  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");

    if (msgId && processedMsgIds.has(msgId)) return;
    processedMsgIds.add(msgId);

    try {
      const senderId =
        data.user?.userId ||
        data.sender?.userId ||
        data.userId;

      if (!senderId) return;

      const sender = await getOrUpdateUser(
        String(senderId),
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsername = sender.username.replace(/^@/, "");

      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      const repeatEnd = !!data.repeatEnd;
      const repeat = Number(data.repeatCount || 1);
      const giftType = Number(data.giftType || 0);

      const credited =
        giftType === 1
          ? repeatEnd
            ? rawDiamonds * repeat
            : 0
          : rawDiamonds;

      if (credited <= 0) return;

      const receiver = await resolveReceiver(data);
      const isHost = receiver.role === "host";

      const gameId = getCurrentGameSessionId();
      const arena = getArena();
      const now = Date.now();

      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;

      const inRound = inActive || inGrace;

      if (isHost && !gameId) return;
      if (!isHost && !inRound) return;

      // DIAMOND/BP ACCOUNTING
      await addDiamonds(BigInt(senderId), credited, "total");
      await addDiamonds(BigInt(senderId), credited, "stream");
      await addDiamonds(BigInt(senderId), credited, "current_round");

      const bpGain = credited * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      if (!isHost && receiver.id && inRound) {
        await safeAddArenaDiamonds(receiver.id.toString(), credited);
      }

      // ------------------------------
      // CHECK FOR TWIST GIFTS
      // ------------------------------
      const giftId = Number(data.giftId);
      let twistType: TwistType | null = null;

      for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
        if (TWIST_MAP[key].giftId === giftId) {
          twistType = key;
          break;
        }
      }

      if (twistType) {
        await addTwistByGift(String(senderId), twistType);

        emitLog({
          type: "twist",
          message: `${sender.display_name} ontving twist: ${TWIST_MAP[twistType].giftName}`,
        });
      }

      // FANCLUB via HeartMe
      if (isHost && (data.giftName?.toLowerCase() === "heart me" || data.giftId === 5655)) {
        await activateFan(BigInt(senderId));

        emitLog({
          type: "gift",
          message: `${sender.display_name} werd FAN voor 24h ❤️`,
        });
      }

      // SAVE IN DATABASE
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

      emitLog({
        type: "gift",
        message: `${sender.display_name} → ${receiver.display_name}: ${data.giftName} (${credited}💎)`,
      });
    } catch (err: any) {
      console.error("GiftEngine ERROR:", err?.message || err);
    }
  });
}
