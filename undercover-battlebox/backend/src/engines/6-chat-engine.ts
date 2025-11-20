// ============================================================================
// 6-chat-engine.ts — v10.1 FINAL
// FAN+VIP chat engine + HARD HOST LOCK + Zero-Unknown identity
// ============================================================================
//
// ✔ Gebruikt nieuwe identity engine (2-user-engine v10.1)
// ✔ Host username blijft stabiel tijdens livestream
// ✔ Displayname updates realtime
// ✔ FAN alleen join
// ✔ VIP label
// ✔ !join / !leave / !boost / !use
// ✔ Perfecte queue integratie
//
// ============================================================================

import pool from "../db";
import { io, emitLog, isStreamLive, getHardHostId } from "../server";

import { addToQueue, leaveQueue, getQueue } from "../queue";
import { getOrUpdateUser } from "./2-user-engine";
import { applyBoost, parseBoostChatCommand } from "./7-boost-engine";
import { parseUseCommand } from "./8-twist-engine";

// ============================================================================
// HELPERS
// ============================================================================

function clean(v: any) {
  return (v || "").toString().trim();
}

function extractCommand(text: string) {
  if (!text.startsWith("!")) return null;
  const p = text.trim().split(/\s+/);
  return { cmd: p[0].toLowerCase(), args: p.slice(1) };
}

async function ensureFanStatus(id: bigint): Promise<boolean> {
  const r = await pool.query(
    `SELECT is_fan, fan_expires_at FROM users WHERE tiktok_id=$1`,
    [id]
  );
  if (!r.rows[0]) return false;

  const { is_fan, fan_expires_at } = r.rows[0];
  if (!is_fan || !fan_expires_at) return false;

  const exp = new Date(fan_expires_at);
  if (exp <= new Date()) {
    await pool.query(
      `UPDATE users SET is_fan=FALSE, fan_expires_at=NULL WHERE tiktok_id=$1`,
      [id]
    );
    return false;
  }

  return true;
}

// ============================================================================
// MAIN CHAT ENGINE
// ============================================================================
export function initChatEngine(conn: any) {
  console.log("💬 CHAT ENGINE v10.1 LOADED");

  conn.on("chat", async (msg: any) => {
    try {
      const rawUser =
        msg.user ||
        msg.sender ||
        msg.userIdentity ||
        msg._data ||
        msg;

      const uid =
        rawUser?.userId ||
        rawUser?.id ||
        rawUser?.uid ||
        msg.userId ||
        msg.senderUserId ||
        null;

      if (!uid) return;

      const text = clean(msg.comment || msg.text || msg.content);
      if (!text.startsWith("!")) return;

      const command = extractCommand(text);
      if (!command) return;

      const { cmd } = command;

      // identity sync
      const user = await getOrUpdateUser(
        String(uid),
        rawUser?.nickname,
        rawUser?.uniqueId
      );

      const userId = BigInt(uid);
      const hostId = getHardHostId();
      const isHost = hostId && String(hostId) === String(uid);

      // FAN / VIP
      const isFan = await ensureFanStatus(userId);

      const vipRow = await pool.query(
        `SELECT is_vip FROM users WHERE tiktok_id=$1`,
        [userId]
      );

      const isVip = !!vipRow.rows[0]?.is_vip;
      const tag = isVip ? "[VIP] " : isFan ? "[FAN] " : "";

      // ================================
      // !join
      // ================================
      if (cmd === "!join") {
        if (isHost) {
          if (isStreamLive()) {
            emitLog({
              type: "queue",
              message: `[HOST] ${user.display_name} mag niet joinen tijdens livestream.`,
            });
            return;
          }

          await addToQueue(String(uid), user.username);
          io.emit("updateQueue", { open: true, entries: await getQueue() });

          emitLog({
            type: "queue",
            message: `[HOST] ${user.display_name} staat nu in de wachtrij.`,
          });

          return;
        }

        if (!isFan) {
          emitLog({
            type: "queue",
            message: `${user.display_name} probeerde te joinen maar is geen fan.`,
          });
          return;
        }

        await addToQueue(String(uid), user.username);
        io.emit("updateQueue", { open: true, entries: await getQueue() });

        emitLog({
          type: "queue",
          message: `${tag}${user.display_name} staat nu in de wachtrij.`,
        });

        return;
      }

      // ================================
      // !leave
      // ================================
      if (cmd === "!leave") {
        const refund = await leaveQueue(String(uid));
        io.emit("updateQueue", { open: true, entries: await getQueue() });

        emitLog({
          type: "queue",
          message: `${tag}${user.display_name} heeft de queue verlaten (refund ${refund} BP).`,
        });

        return;
      }

      // ================================
      // !boost x
      // ================================
      if (cmd === "!boost") {
        const spots = await parseBoostChatCommand(text);
        if (!spots) return;

        try {
          const result = await applyBoost(String(uid), spots, user.display_name);

          io.emit("updateQueue", {
            open: true,
            entries: await getQueue(),
          });

          emitLog({
            type: "boost",
            message: `${tag}${user.display_name}: ${result.message}`,
          });

        } catch (err: any) {
          emitLog({ type: "boost", message: err.message });
        }

        return;
      }

      // ================================
      // !use <twist>
      // ================================
      if (cmd === "!use") {
        await parseUseCommand(
          String(uid),
          user.display_name,
          msg.comment || msg.text || msg.content
        );
        return;
      }
    } catch (err: any) {
      console.error("CHAT ERROR:", err);
    }
  });
}
