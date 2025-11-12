import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";
import { addDiamonds, addBP } from "./4-points-engine";
import { getArena, addDiamondsToArenaPlayer } from "./5-game-engine";
import { emitLog } from "../server";
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
    const giftName = data.giftName || "Onbekend";

    if (msgId && processedMsgIds.has(msgId)) return;

    try {
      const senderId = (
        data.user?.userId || data.sender?.userId || data.userId || "0"
      ).toString();
      if (senderId === "0") return;

      const giftType = Number(data.giftType ?? 0);
      const repeatEnd = Boolean(data.repeatEnd);
      const repeatCount = Number(data.repeatCount ?? 1);
      const rawDiamondCount = Number(data.diamondCount ?? 0);
      if (rawDiamondCount <= 0) return;

      let creditedDiamonds = 0;
      if (giftType === 1) {
        if (!repeatEnd) return;
        creditedDiamonds = rawDiamondCount * repeatCount;
      } else creditedDiamonds = rawDiamondCount;

      if (msgId) processedMsgIds.add(msgId);

      const sender = await getOrUpdateUser(
        senderId,
        data.user?.nickname || data.sender?.nickname,
        data.user?.uniqueId || data.sender?.uniqueId
      );

      const receiverUniqueId =
        (
          data.toUser?.uniqueId ||
          data.receiver?.uniqueId ||
          data.receiverUniqueId ||
          ""
        )
          .toString()
          .replace("@", "")
          .toLowerCase()
          .trim() || HOST_USERNAME;

      const isToHost = receiverUniqueId === HOST_USERNAME;
      const receiverName = isToHost ? HOST_USERNAME.toUpperCase() : "COHOST";

      await addDiamonds(BigInt(senderId), creditedDiamonds, "total");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "stream");
      await addDiamonds(BigInt(senderId), creditedDiamonds, "current_round");

      const bpGain = creditedDiamonds * 0.2;
      await addBP(BigInt(senderId), bpGain, "GIFT", sender.display_name);

      if (!isToHost) {
        const arena = getArena();
        if (arena.players.some((p: any) => p.id === senderId)) {
          await addDiamondsToArenaPlayer(senderId, creditedDiamonds);
        }
      }

      await pool.query(
        `INSERT INTO gifts (
          giver_id, giver_username, giver_display_name,
          gift_name, diamonds, bp, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [
          BigInt(senderId),
          sender.username,
          sender.display_name,
          giftName,
          creditedDiamonds,
          bpGain,
        ]
      );

      // 🎁 Log zichtbaar in dashboard
      emitLog({
        type: "gift",
        message: `${sender.display_name} (@${sender.username}) → ${receiverName}: ${giftName} (${creditedDiamonds}💎${
          repeatCount > 1 ? `, streak x${repeatCount}` : ""
        })`,
        giver_display_name: sender.display_name,
        giver_username: sender.username,
        receiver_display_name: receiverName,
        diamonds: creditedDiamonds,
      });
    } catch (err: any) {
      console.error("GiftEngine error:", err?.message || err);
    }
  });

  console.log(`[GIFT ENGINE] Actief – Host: @${HOST_USERNAME}`);
}
