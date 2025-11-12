// src/engines/3-gift-engine.ts
// GIFT ENGINE – streak-safe, ontvanger-gebaseerde arena-score, game stats
// Regels:
// - Host-gifts tellen ALTIJD mee in de prijzenpot (ook buiten ronde/grace).
// - Speler-gifts tellen ALLEEN mee tijdens ronde (active) of grace.
// - Arena-score gaat naar de ONTVANGER als die speler in de arena staat.
// - Sender krijgt diamonds voor zijn eigen totalen + BP, ongeacht ronde.
// - Automatisch een game starten als er host-gifts zijn zonder actieve game.

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog, getCurrentGameId, broadcastStats } from "../server";
import dotenv from "dotenv";

dotenv.config();

const HOST_USERNAME = (process.env.TIKTOK_USERNAME || "")
  .replace("@", "")
  .toLowerCase()
  .trim();

if (!HOST_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

// Eenvoudige dedup op msgId
const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    const giftName: string = data.giftName || "Onbekend";
    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      // 1) Sender (gifter)
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const giftType = Number(data.giftType ?? 0); // 1 = streak
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount ?? 1);
      const rawDiamondCount = Number(data.diamondCount ?? 0);
      if (!rawDiamondCount || rawDiamondCount <= 0) return;

      // 2) Streak-afhandeling
      let creditedDiamonds = 0;
      if (giftType === 1) {
        // streak: alleen laatste event met repeatEnd
        if (!repeatEnd) return;
        creditedDiamonds = rawDiamondCount * repeatCount;
      } else {
        creditedDiamonds = rawDiamondCount;
      }
      if (creditedDiamonds <= 0) return;

      if (msgId) processedMsgIds.add(msgId);

      // 3) Sender-profiel
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );
      const senderUsernameClean = sender.username.replace(/^@+/, "");

      // 4) Receiver (host of speler)
      const receiverUniqueIdRaw =
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        "";

      const receiverUniqueId = String(receiverUniqueIdRaw)
        .replace("@", "")
        .toLowerCase()
        .trim();

      const receiverNicknameRaw: string =
        data.toUser?.nickname ||
        data.receiver?.nickname ||
        data.toUser?.displayName ||
        "";

      const receiverUserIdRaw =
        data.receiverUserId ||
        data.toUserId ||
        data.toUser?.userId ||
        data.receiver?.userId ||
        null;

      const isToHost =
        !receiverUserIdRaw ||
        receiverUniqueId === HOST_USERNAME ||
        (receiverNicknameRaw || "").toLowerCase().includes(HOST_USERNAME);

      let receiverId: string | null = null;
      let receiverDisplayName: string;
      let receiverUsername: string;
      let receiverRole: "host" | "speler";

      if (isToHost) {
        receiverDisplayName =
          receiverNicknameRaw || HOST_USERNAME.toUpperCase();
        receiverUsername = HOST_USERNAME;
        receiverRole = "host";
      } else {
        const receiverUserId = String(receiverUserIdRaw);
        const receiver = await getOrUpdateUser(
          receiverUserId,
          receiverNicknameRaw,
          receiverUniqueId
        );
        receiverId = receiver.id;
        receiverDisplayName = receiver.display_name;
        receiverUsername = receiver.username.replace(/^@+/, "");
        receiverRole = "speler";
      }

      // 5) Ronde/grace status bepalen
      const arenaSnapshot = getArena();
      const now = Date.now();
      const inActive =
        arenaSnapshot.status === "active" && now <= arenaSnapshot.roundCutoff;
      const inGrace =
        arenaSnapshot.status === "grace" && now <= arenaSnapshot.graceEnd;

      // 6) Toelatingsregels:
      // - Host: altijd doorlaten (prijzenpot)
      // - Speler: alleen tijdens active/grace
      if (!isToHost && !(inActive || inGrace)) {
        const recv = receiverUniqueId || "onbekend";
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${giftName} → ${recv}`,
        });
        return;
      }

      // 7) Sender krijgt diamonds & BP (profiel)
      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");
      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      // 8) Arena-score naar ontvanger indien speler in arena (alleen bij spelers)
      if (!isToHost && receiverId) {
        const arena2 = getArena();
        if (arena2.players.some((p: any) => p.id === receiverId)) {
          await addDiamondsToArenaPlayer(receiverId, creditedDiamonds);
        }
      }

      // 9) Database log (met game_id)
      //    - Host: forceer altijd game_id (start automatisch als nodig)
      //    - Spelers: game_id moet er zijn (want we zitten in ronde/grace)
      let gameIdToUse = getCurrentGameId();
      if (!gameIdToUse && isToHost) {
        // games-tabel aanmaken indien nodig
        await pool.query(`
          CREATE TABLE IF NOT EXISTS games (
            id SERIAL PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'running',
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at   TIMESTAMPTZ
          )
        `);
        const res = await pool.query(
          `INSERT INTO games (status) VALUES ('running') RETURNING id`
        );
        gameIdToUse = res.rows[0]?.id ?? null;
        emitLog({
          type: "system",
          message: `[AUTO GAME] Nieuwe sessie aangemaakt voor host-gifts (#${gameIdToUse})`,
        });
      }

      await pool.query(
        `
        INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          receiver_id, receiver_username, receiver_display_name, receiver_role,
          gift_name, diamonds, bp, game_id, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        `,
        [
          BigInt(senderId),
          senderUsernameClean,
          sender.display_name,
          receiverId ? BigInt(receiverId) : null,
          receiverUsername,
          receiverDisplayName,
          receiverRole,
          giftName,
          creditedDiamonds,
          bpGain,
          gameIdToUse,
        ]
      );

      // 10) Dashboard log
      const receiverLabel = isToHost
        ? `${receiverDisplayName} (@${HOST_USERNAME}) [HOST]`
        : `${receiverDisplayName} (@${receiverUsername}) [SPELER]`;

      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${senderUsernameClean}) → ${receiverLabel}: ${giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
        giver_display_name: sender.display_name,
        giver_username: senderUsernameClean,
        receiver_display_name: receiverDisplayName,
        receiver_username: receiverUsername,
        receiver_role: receiverRole,
        diamonds: creditedDiamonds,
        game_id: gameIdToUse,
      });

      // 11) Stats & leaderboard updaten
      await broadcastStats();
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_USERNAME}`);
}
