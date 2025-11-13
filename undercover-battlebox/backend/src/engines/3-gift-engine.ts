// src/engines/3-gift-engine.ts — v1.2 dynamic-host
// - Host wordt ALTIJD geladen uit database key: host_username
// - Geen afhankelijkheid meer van .env
// - Database-first receiver matching
// - Debug heavy receiver logging
// - 100% compatibel met alle eerdere engines

import pool, { getSetting } from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";

import dotenv from "dotenv";
dotenv.config();

// Normalizer helper
function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// Cached host username (reload on change)
let HOST_USERNAME_CACHE = "";

// Refresh host from DB
export async function refreshHostUsername() {
  const h = (await getSetting("host_username")) || "";
  HOST_USERNAME_CACHE = h.trim().replace("@", "").toLowerCase();
  console.log("🔄 HOST UPDATED:", HOST_USERNAME_CACHE || "(none)");
}

// Initial load
await refreshHostUsername();

// =======================================================================
// RESOLVE RECEIVER  (event → database-first resolve)
// =======================================================================
async function resolveReceiver(event: any) {
  console.log("────────────────────────────────────────────");
  console.log("🎯 RECEIVER RESOLVE DEBUG");
  console.log("HOST (DB) =", HOST_USERNAME_CACHE);
  console.log("--------------------------------------------");

  const hostRaw = HOST_USERNAME_CACHE;

  // Extract TikTok event fields
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

  const uniqueNorm = uniqueRaw ? norm(uniqueRaw) : null;

  const nickRaw =
    event.toUser?.nickname ||
    event.receiver?.nickname ||
    event.toUser?.displayName ||
    null;

  const nickNorm = nickRaw ? norm(nickRaw) : null;

  console.log("receiverUserId =", eventId);
  console.log("uniqueId =", uniqueRaw, "→", uniqueNorm);
  console.log("nickname =", nickRaw, "→", nickNorm);

  // 1) Direct uniqueId match
  if (uniqueNorm && hostRaw && uniqueNorm === hostRaw) {
    console.log("➡ HOST detected by uniqueId");
    return {
      id: null,
      username: hostRaw,
      display_name: uniqueRaw,
      role: "host",
    };
  }

  // 2) Fuzzy nickname contains host
  if (nickNorm && hostRaw && nickNorm.includes(hostRaw)) {
    console.log("➡ HOST detected by nickname fuzzy match");
    return {
      id: null,
      username: hostRaw,
      display_name: nickRaw || hostRaw,
      role: "host",
    };
  }

  // 3) Database lookup (strongest)
  if (eventId) {
    const r = await getOrUpdateUser(
      String(eventId),
      nickRaw || null,
      uniqueRaw || null
    );

    console.log("DB result:", {
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      usernameNorm: norm(r.username),
    });

    if (hostRaw && norm(r.username) === hostRaw) {
      console.log("➡ HOST detected by database username");
      return {
        id: r.id,
        username: r.username.replace(/^@/, ""),
        display_name: r.display_name,
        role: "host",
      };
    }

    console.log("➡ PLAYER");
    return {
      id: r.id,
      username: r.username.replace(/^@/, ""),
      display_name: r.display_name,
      role: "speler",
    };
  }

  // 4) TikTok gave NOTHING
  if (hostRaw) {
    console.log("❗ NO receiver info → fallback HOST (safe mode)");
    return {
      id: null,
      username: hostRaw,
      display_name: hostRaw,
      role: "host",
    };
  }

  console.log("❗ NO receiver info & NO HOST SET");
  return {
    id: null,
    username: "",
    display_name: "UNKNOWN",
    role: "speler",
  };
}

// =======================================================================
// STREAK DEDUP
// =======================================================================

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60000);

// =======================================================================
// GIFT ENGINE INIT
// =======================================================================

export function initGiftEngine(conn: any) {
  console.log("🎁 GIFT ENGINE LOADED (v1.2 dynamic-host)");

  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // Sender
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

      // Gift value
      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      const repeatEnd = !!data.repeatEnd;
      const repeat = Number(data.repeatCount || 1);
      const giftType = Number(data.giftType || 0);

      let credited = giftType === 1
        ? repeatEnd
          ? rawDiamonds * repeat
          : 0
        : rawDiamonds;

      if (credited <= 0) return;

      processedMsgIds.add(msgId);

      // Resolve receiver
      const receiver = await resolveReceiver(data);
      const isHost = receiver.role === "host";

      const gameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();

      const inActive =
        arena.status === "active" && now <= arena.roundCutoff;

      const inGrace =
        arena.status === "grace" && now <= arena.graceEnd;

      const inRound = inActive || inGrace;

      // Gift rules
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

      // Apply points
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

      // Log to admin
      const label = isHost
        ? `${receiver.display_name} [HOST]`
        : `${receiver.display_name} (@${receiver.username})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsername}) → ${label}: ${data.giftName} (${credited}💎${repeat > 1 ? ` x${repeat}` : ""
          })`,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });
}
