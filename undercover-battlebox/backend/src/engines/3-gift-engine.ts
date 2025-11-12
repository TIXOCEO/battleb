// src/engines/3-gift-engine.ts
// GIFT ENGINE – streak-safe, ontvanger-gebaseerde arena-score, game stats, cutoff/grace

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

const processedMsgIds = new Set<string>();
setInterval(() => processedMsgIds.clear(), 60_000);

export function initGiftEngine(conn: any) {
  conn.on("gift", async (data: any) => {
    const msgId = String(data.msgId ?? data.id ?? data.logId ?? "");
    const giftName: string = data.giftName || "Onbekend";

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      const senderId = (
        data.user?.userId ||
        data.sender?.userId ||
        data.userId ||
        "0"
      ).toString();
      if (senderId === "0") return;

      const giftType = Number(data.giftType ?? 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount ?? 1);
      const rawDiamondCount = Number(data.diamondCount ?? 0);
      if (!rawDiamondCount || rawDiamondCount <= 0) return;

      let creditedDiamonds = 0;
      if (giftType === 1) {
        if (!repeatEnd) return;
        creditedDiamonds = rawDiamondCount * repeatCount;
      } else {
        creditedDiamonds = rawDiamondCount;
      }
      if (creditedDiamonds <= 0) return;
      if (msgId) processedMsgIds.add(msgId);

      // SENDER
      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );
      const senderUsernameClean = sender.username.replace(/^@+/, "");

      // RECEIVER (host of speler)
      const receiverUniqueIdRaw =
        data.toUser?.uniqueId ||
        data.receiver?.uniqueId ||
        data.receiverUniqueId ||
        "";

      const receiverUniqueId = receiverUniqueIdRaw
        .toString()
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
        receiverDisplayName = receiverNicknameRaw || HOST_USERNAME.toUpperCase();
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

      // Check ronde status
      const arena = getArena();
      const now = Date.now();
      const inActive = arena.status === "active" && now <= arena.roundCutoff;
      const inGrace = arena.status === "grace" && now <= arena.graceEnd;
      const isInRound = inActive || inGrace;

      // ❌ Spelers → spelers buiten ronde → negeren
      if (!isToHost && !isInRound) {
        emitLog({
          type: "system",
          message: `[GIFT IGNORE] Buiten ronde: ${giftName} → ${receiverDisplayName}`,
        });
