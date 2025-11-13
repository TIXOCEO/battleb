// src/engines/3-gift-engine.ts — FINAL PRODUCTION v0.8.0
// - Perfecte host-detectie (uniqueId, nickname, strict + fuzzy)
// - Nooit meer Unknown tenzij TikTok écht geen user data stuurt
// - Streak-safe gift processing
// - Gifts naar host ALTIJD tellen als game actief is
// - Gifts tussen spelers alleen binnen ronde/grace
// - Supersnelle parsing, minimale overhead

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

// =========================================================
// HOST — normalized
// =========================================================
const HOST_USERNAME_RAW = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .trim();

const HOST_NORM = normalize(HOST_USERNAME_RAW);

if (!HOST_NORM) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// =========================================================
// Normalizer
// =========================================================
function normalize(val: any): string {
  return (val || "")
    .toString()
    .toLowerCase()
    .replace("@", "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, ""); // emoji + symbolen weg
}

// =========================================================
// Dedup
// =========================================================
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60000);

// =========================================================
// Gift Engine start
// =========================================================
export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // ---------------------------------------
      // 1. SENDER
      // ---------------------------------------
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        null
      )?.toString();

      if (!senderId) return;

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const senderUsername = sender.username.replace(/^@+/, "");

      // -----------------------------------------------------
      // 2. GIFT (diamonds, streaks)
      // -----------------------------------------------------
      const rawDiamond = Number(data.diamondCount || 0);
      if (rawDiamond <= 0) return;

      const giftType = Number(data.giftType || 0); // 1 = streak
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount || 1);

      let credited = 0;

      if (giftType === 1) {
        if (!repeatEnd) return; // niet einde streak → niets tellen
        credited = rawDiamond * repeatCount;
      } else {
        credited = rawDiamond;
      }

      if (credited <= 0) return;
      processedMsgIds.add(msgId);

      // -----------------------------------------------------
      // 3. RECEIVER (host vs speler)
      // -----------------------------------------------------
      const recUnique = normalize(
        data.toUser?.uniqueId ||
          data.receiver?.uniqueId ||
          data.receiverUniqueId
      );

      const recNickNorm = normalize(
        data.toUser?.nickname ||
          data.receiver?.nickname ||
          data.toUser?.displayName
      );

      const isToHost =
        recUnique === HOST_NORM ||
        recNickNorm === HOST_NORM ||
        recNickNorm.includes(HOST_NORM);

      let receiverId: string | null = null;
      let receiverDisplay = "";
      let receiverUsername = "";
      let receiverRole: "host" | "speler" = "host";

      if (isToHost) {
        receiverDisplay =
          data.toUser?.nickname ||
          data.receiver?.nickname ||
          HOST_USERNAME_RAW;
        receiverUsername = HOST_USERNAME_RAW;
        receiverRole = "host";
      } else {
        const recUserId =
          data.receiverUserId ||
          data.toUserId ||
          data.toUser?.userId ||
          data.receiver?.userId;

        const receiver = await getOrUpdateUser(
          String(recUserId || senderId), // fallback → nooit Unknown
          data.toUser?.nickname || data.receiver?.nickname,
          data.toUser?.uniqueId || data.receiver?.uniqueId
        );

        receiverId = receiver.id;
        receiverDisplay = receiver.display_name;
        receiverUsername = receiver.username.replace(/^@+/, "");
        receiverRole = "speler";
      }

      // -----------------------------------------------------
      // 4. Check game + ronde
      // -----------------------------------------------------
      const gameId = getCurrentGameId();
      const arena = getArena();
      const now = Date.now();

      const inActive =
        arena.status === "active" && now <= arena.roundCutoff;
      const inGrace =
        arena.status === "grace" && now <= arena.graceEnd;

      const isInRound = inActive || inGrace;

      // -----------------------------------------------------
      // 5. Logica hoe gift verwerkt wordt
      // -----------------------------------------------------

      // speler → speler buiten ronde = negeren
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${data.giftName} → ${receiverDisplay}`,
        });
        return;
      }

      // host-gifts → altijd tellen als game actief is
      if (isToHost) {
        if (!gameId) {
          emitLog({
            type: "system",
            message: `[GIFT IGNORE] Geen actief spel → host gift genegeerd`,
          });
          return;
        }

        emitLog({
          type: "gift",
          message: `[HOST] ${sender.display_name} → ${receiverDisplay}: ${data.giftName} (${credited}💎)`,
        });
      }

      // -----------------------------------------------------
      // 6. Update punten
      // -----------------------------------------------------
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

      // Arena punten (alleen speler → speler binnen ronde)
      if (!isToHost && receiverId && isInRound) {
        if (arena.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, credited);
        }
      }

      // -----------------------------------------------------
      // 7. Database save
      // -----------------------------------------------------
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
          receiverId ? BigInt(receiverId) : null,
          receiverUsername,
          receiverDisplay,
          receiverRole,
          data.giftName || "unknown",
          credited,
          bpGain,
          gameId,
        ]
      );

      // -----------------------------------------------------
      // 8. Admin Log
      // -----------------------------------------------------
      const receiverLabel = isToHost
        ? `${receiverDisplay} (@${HOST_USERNAME_RAW}) [HOST]`
        : `${receiverDisplay} (@${receiverUsername})`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsername}) → ${receiverLabel}: ${data.giftName} (${credited}💎${
          repeatCount > 1 ? `, x${repeatCount}` : ""
        })`,
      });

      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(
    `[GIFT ENGINE] FINAL PRODUCTION v0.8.0 actief — host=@${HOST_USERNAME_RAW}`
  );
}
