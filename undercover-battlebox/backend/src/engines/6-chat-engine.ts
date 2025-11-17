// ============================================================================
// src/engines/6-chat-engine.ts — v2.0 FINAL
//
// ✔ Geen emitQueue import meer
// ✔ addToQueue(String(userId)) (1 arg!)
// ✔ Queue updates via io.emit("updateQueue")
// ✔ Fans-only !join
// ✔ !leave correct
// ✔ !boost correct
// ✔ getOrUpdateUser synced
// ✔ 0 compat errors met TypeScript
//
// ============================================================================

import pool from "../db";
import { io, emitLog } from "../server";

import { addToQueue, leaveQueue, getQueue } from "../queue";
import { getOrUpdateUser } from "./2-user-engine";
import { applyBoost, parseBoostChatCommand } from "./7-boost-engine";

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function clean(v: any) {
  return (v || "").toString().trim();
}

function extractCommand(text: string) {
  if (!text.startsWith("!")) return null;
  const p = text.trim().split(/\s+/);
  return { cmd: p[0].toLowerCase(), args: p.slice(1) };
}

async function ensureFanStatus(userId: bigint): Promise<boolean> {
  const r = await pool.query(
    `
    SELECT is_fan, fan_expires_at
    FROM users
    WHERE tiktok_id=$1
  `,
    [userId]
  );

  if (!r.rows[0]) return false;

  const { is_fan, fan_expires_at } = r.rows[0];
  if (!is_fan || !fan_expires_at) return false;

  const exp = new Date(fan_expires_at);
  if (exp <= new Date()) {
    await pool.query(
      `UPDATE users SET is_fan=FALSE, fan_expires_at=NULL WHERE tiktok_id=$1`,
      [userId]
    );
    return false;
  }

  return true;
}

// ------------------------------------------------------
// MAIN ENGINE
// ------------------------------------------------------

export function initChatEngine(conn: any) {
  console.log("💬 CHAT ENGINE v2.0 LOADED");

  conn.on("chat", async (msg: any) => {
    try {
      const userId =
        msg.user?.userId ||
        msg.sender?.userId ||
        msg.userId ||
        msg.uid;

      if (!userId) return;

      const text = clean(msg.comment || msg.text || msg.content);
      if (!text.startsWith("!")) return;

      const command = extractCommand(text);
      if (!command) return;

      const { cmd } = command;

      const user = await getOrUpdateUser(
        String(userId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      const dbUserId = BigInt(userId);
      const isFan = await ensureFanStatus(dbUserId);

      // --------------------------------------------------
      // !join — FAN ONLY
      // --------------------------------------------------
      if (cmd === "!join") {
        if (!isFan) {
          emitLog({
            type: "queue",
            message: `${user.display_name} probeerde te joinen maar is geen fan.`,
          });
          return;
        }

        await addToQueue(String(userId));

        io.emit("updateQueue", {
          open: true,
          entries: await getQueue(),
        });

        emitLog({
          type: "queue",
          message: `${user.display_name} staat nu in de wachtrij.`,
        });

        return;
      }

      // --------------------------------------------------
      // !leave
      // --------------------------------------------------
      if (cmd === "!leave") {
        const refund = await leaveQueue(String(userId));

        io.emit("updateQueue", {
          open: true,
          entries: await getQueue(),
        });

        emitLog({
          type: "queue",
          message: `${user.display_name} heeft de queue verlaten (refund ${refund} BP).`,
        });

        return;
      }

      // --------------------------------------------------
      // !boost X
      // --------------------------------------------------
      if (cmd === "!boost") {
        const spots = await parseBoostChatCommand(text);
        if (!spots) return;

        const result = await applyBoost(String(userId), spots, user.display_name);

        io.emit("updateQueue", {
          open: true,
          entries: await getQueue(),
        });

        emitLog({
          type: "boost",
          message: `${user.display_name}: ${result.message}`,
        });

        return;
      }
    } catch (err: any) {
      console.error("CHAT ENGINE ERROR:", err?.message || err);
    }
  });
}
