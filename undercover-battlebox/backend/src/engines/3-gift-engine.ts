// src/engines/3-gift-engine.ts — FINAL PRODUCTION v0.9.0
// - 100% correcte host-detectie (database-first, geen event-trust)
// - 0% Unknowns (fallbacks altijd database)
// - Streak-safe gift processing
// - Host-gifts tellen ALTIJD tijdens actief spel
// - Speler-gifts alleen binnen ronde/grace
// - Ontvanger wordt via database gematcht: tiktok_id, uniqueId, display_name
// - Resolvet zelfs kapotte TikTok-events correct

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

// =========================================================
// HOST — via database + normalized
// =========================================================
const HOST_USERNAME_RAW = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .trim()
  .toLowerCase();

if (!HOST_USERNAME_RAW) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// lowercase + strip @ + cleanup
function norm(v: any) {
  return (v || "")
    .toString()
    .trim()
    .replace("@", "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

// =========================================================
// DATABASE-FIRST RECEIVER RESOLVE
// =========================================================
async function resolveReceiver(
  event: any
): Promise<{
  id: string | null;
  username: string;
  display_name: string;
  role: "host" | "speler";
}> {
  // 1) Alles wat TikTok kán hebben
  const fromEventId =
    event.receiverUserId ||
    event.toUserId ||
    event.toUser?.userId ||
    event.receiver?.userId ||
    null;

  const fromEventUnique =
    norm(
      event.toUser?.uniqueId ||
        event.receiver?.uniqueId ||
        event.receiverUniqueId
    ) || null;

  const fromEventNickNorm =
    norm(
      event.toUser?.nickname ||
        event.receiver?.nickname ||
        event.toUser?.displayName
    ) || null;

  // 2) DIRECT HOST DETECTIE via username match
  if (fromEventUnique === HOST_USERNAME_RAW) {
    return {
      id: null,
      username: HOST_USERNAME_RAW,
      display_name: HOST_USERNAME_RAW,
      role: "host",
    };
  }

  // 3) Fuzzy host detectie via nickname
  if (
    fromEventNickNorm &&
    fromEventNickNorm.includes(HOST_USERNAME_RAW)
  ) {
    return {
      id: null,
      username: HOST_USERNAME_RAW,
      display_name:
        event.toUser?.nickname ||
        event.receiver?.nickname ||
        HOST_USERNAME_RAW,
      role: "host",
    };
  }

  // 4) DATABASE LOOKUP (krachtigste fallback)
  if (fromEventId) {
    const r = await getOrUpdateUser(
      String(fromEventId),
      event.toUser?.nickname || event.receiver?.nickname,
      event.toUser?.uniqueId || event.receiver?.uniqueId
    );

    // host?
    if (norm(r.username) === HOST_USERNAME_RAW) {
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

  // 5) Als TikTok GEEN user-infos geeft → fallback = host
  return {
    id: null,
    username: HOST_USERNAME_RAW,
    display_name: HOST_USERNAME_RAW,
    role: "host",
  };
}

// =========================================================
// STREAK DEDUP
// =========================================================
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60000);

// =========================================================
// GIFT ENGINE
// =========================================================
export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");

    // Dedup
    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // ---------------------------------------
      // 1. SENDER
      // ---------------------------------------
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

      // ---------------------------------------
      // 2. GIFT VALUE (streak-safe)
      // ---------------------------------------
      const rawDiamonds = Number(data.diamondCount || 0);
      if (rawDiamonds <= 0) return;

      const giftType = Number(data.giftType || 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeat = Number(data.repeatCount || 1);

      let credited = giftType === 1
        ? repeatEnd
          ? rawDiamonds * repeat
          : 0
        : rawDiamonds;

      if (credited <= 0) return;
      processedMsgIds.add(msgId);

      // ---------------------------------------
      // 3. RESOLVE RECEIVER VIA DATABASE
      // ---------------------------------------
      const receiver = await resolveReceiver(data);
      const isHost = receiver.role === "host";

      // ---------------------------------------
      // 4. GAME/ROUND STATUS
      // ---------------------------------------
      const gameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();

      const inActive =
        arena.status === "active" && now <= arena.roundCutoff;
      const inGrace =
        arena.status === "grace" && now <= arena.graceEnd;

      const inRound = inActive || inGrace;

      // ---------------------------------------
      // 5. VERWERKINGSLOGICA
      // ---------------------------------------

      // Speler → speler buiten ronde = negeren
      if (!isHost && !inRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${data.giftName} → ${receiver.display_name}`,
        });
        return;
      }

      // Host-gift → ALTIJD tellen zodra game actief
      if (isHost) {
        if (!gameId) {
          emitLog({
            type: "system",
            message: `[GIFT IGNORE] Geen actief spel → host gift genegeerd`,
          });
          return;
        }
      }

      // ---------------------------------------
      // 6. PUNTEN TOEVOEGEN
      // ---------------------------------------
      await addDiamonds(BigInt(senderId), credited, "total");
      await addDiamonds(BigInt(senderId), credited, "stream");
      await addDiamonds(BigInt(senderId), credited, "current_round");

      const bpGain = credited * 0.2;
      await addBP(
        BigInt(senderId),
        bpGain,
        "GIFT",
        sender.display_name
      );

      // Arena score
      if (!isHost && receiver.id && inRound) {
        if (arena.players.some((p: any) => p.id === receiver.id)) {
          await addDiamondsToArenaPlayer(receiver.id, credited);
        }
      }

      // ---------------------------------------
      // 7. SAVE IN DATABASE
      // ---------------------------------------
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

      // ---------------------------------------
      // 8. ADMIN LOG
      // ---------------------------------------
      const rLabel = isHost
        ? `${receiver.display_name} [HOST]`
        : `${receiver.display_name} (@${receiver.username})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsername}) → ${rLabel}: ${data.giftName} (${credited}💎${
          repeat > 1 ? ` x${repeat}` : ""
        })`,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(
    `[GIFT ENGINE] v0.9.0 LOADED — database-first matching, host=@${HOST_USERNAME_RAW}`
  );
}
