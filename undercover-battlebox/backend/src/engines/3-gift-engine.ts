// ============================================================================
// 3-gift-engine.ts — v5.0 (Danny Super Stable)
// ============================================================================
//
// ✔ Twist mapping / Gift tracking
// ✔ Host-only diamonds naar stats
// ✔ Live debug logs @ emitLog
// ✔ Danger zone per round type fixed
// ✔ Resolves unknown users live + logs
//
// ============================================================================

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, safeAddArenaDiamonds } from "./5-game-engine";
import { emitLog, io, broadcastStats } from "../server";

import { TWIST_MAP, TwistType } from "./twist-definitions";
import { addTwistByGift } from "./8-twist-engine";

// ============================================================================
// GAME SESSION ID
// ============================================================================

function getCurrentGameSessionId(): number | null {
  return (io as any).currentGameId ?? null;
}

// ============================================================================
// NORMALIZER
// ============================================================================

const norm = (v: any) =>
  (v || "").toString().trim().replace("@", "").toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");

// ============================================================================
// HOST CACHE
// ============================================================================

let HOST_USERNAME_CACHE = "";

export async function initDynamicHost() {
  await refreshHostUsername();
}

export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = norm(h);
  console.log("🔄 HOST UPDATED:", HOST_USERNAME_CACHE || "(none)");
}

// ============================================================================
// DUPLICATE FILTER
// ============================================================================

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

// ============================================================================
// USER RESOLVER
// ============================================================================

async function resolveReceiver(event: any) {
  const hostNorm = HOST_USERNAME_CACHE;
  const incoming = {
    id:
      event.receiverUserId ||
      event.toUserId ||
      event.toUser?.userId ||
      event.receiver?.userId ||
      null,
    username: norm(event.toUser?.uniqueId || event.receiver?.uniqueId || null),
    display: event.toUser?.nickname || event.receiver?.nickname || "",
  };

  if (incoming.username && incoming.username === hostNorm) {
    return { id: null, username: hostNorm, display_name: incoming.display || hostNorm, role: "host" };
  }

  if (incoming.id) {
    const resolved = await getOrUpdateUser(String(incoming.id), incoming.display, incoming.username);
    return {
      id: resolved.id,
      username: resolved.username.replace(/^@/, ""),
      display_name: resolved.display_name,
      role: resolved.username.replace(/^@/, "").toLowerCase() === hostNorm ? "host" : "speler",
    };
  }

  return { id: null, username: "", display_name: "UNKNOWN", role: "speler" };
}

// ============================================================================
// FANCLUB 24H — heart me gift
// ============================================================================

async function activateFan(userId: bigint) {
  await pool.query(
    `
    UPDATE users
    SET is_fan = true,
        fan_expires_at = NOW() + INTERVAL '24 hours'
    WHERE tiktok_id = $1
    `,
    [userId]
  );
}

// ============================================================================
// GIFT ENGINE
// ============================================================================

export function initGiftEngine(conn: any) {
  if (!conn?.on) {
    console.warn("❌ initGiftEngine misconfigured → IDLE");
    return;
  }

  console.log("🎁 GIFT ENGINE v5.0 ACTIVE");

  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    if (msgId && processedMsgIds.has(msgId)) return;
    processedMsgIds.add(msgId);

    try {
      const senderRawId =
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        null;

      if (!senderRawId) return;

      const sender = await getOrUpdateUser(
        String(senderRawId),
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      // Live debug: user resolved
      if (sender.display_name === "UNKNOWN" || sender.username === "UNKNOWN") {
        emitLog({
          type: "info",
          message: `[RESOLVE_USER] ${senderRawId} → ${sender.display_name} (@${sender.username})`,
        });
      }

      const giftDiamonds = Number(data.diamondCount || 0);
      if (giftDiamonds <= 0) return;

      const creditedDiamonds =
        data.giftType === 1 && !data.repeatEnd
          ? 0
          : giftDiamonds * (data.repeatCount || 1);

      if (creditedDiamonds <= 0) return;

      const receiver = await resolveReceiver(data);
      const isHost = receiver.role === "host";

      const gameId = getCurrentGameSessionId();
      if (isHost && !gameId) return;
      if (!isHost && getArena().status !== "active") return;

      // Database + stats update
      await addDiamonds(BigInt(senderRawId), creditedDiamonds, "total");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderRawId), bpGain, "GIFT", sender.display_name);

      if (!isHost && receiver.id) {
        await safeAddArenaDiamonds(receiver.id.toString(), creditedDiamonds);
      }

      // Twist mapping
      const twistType = Object.keys(TWIST_MAP).find(
        (k) => TWIST_MAP[k as TwistType].giftId === data.giftId
      );

      if (twistType) {
        await addTwistByGift(String(senderRawId), twistType as TwistType);
        emitLog({
          type: "twist",
          message: `${sender.display_name} ontving twist: ${TWIST_MAP[twistType as TwistType].giftName}`,
        });
      }

      // Fanclub: Heart Me
      if (isHost && (data.giftName?.toLowerCase() === "heart me" || data.giftId === 5655)) {
        await activateFan(BigInt(senderRawId));
      }

      // Gift opslaan
      await pool.query(
        `
        INSERT INTO gifts (giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name, receiver_role,
          gift_name, diamonds, bp, game_id, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      `,
        [
          BigInt(senderRawId),
          sender.username.replace(/^@/, ""),
          sender.display_name,
          receiver.id ? BigInt(receiver.id) : null,
          receiver.username,
          receiver.display_name,
          receiver.role,
          data.giftName || "unknown",
          creditedDiamonds,
          bpGain,
          gameId,
        ]
      );

      emitLog({
        type: "gift",
        message: `${sender.display_name} → ${receiver.display_name}: ${data.giftName} (${creditedDiamonds}💎)`,
      });

      // Stats update
      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine ERROR:", err?.message || err);
    }
  });
});

