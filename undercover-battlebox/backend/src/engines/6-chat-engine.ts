// src/engines/6-chat-engine.ts
// CHAT ENGINE — v1.2 (Heart Me + JOIN + BOOST via chat ONLY)

// Functies:
//  - Heart Me gift activeert fan-status (elders via gift-engine)
//  - Alleen fans mogen !join doen
//  - !boost X → kost 200 BP per plek
//  - Alleen mogelijk als gebruiker in queue staat
//  - Geen autojoin in arena
//  - !leave geeft refund (queue.ts regelt dit)
//  - Admin UI gebruikt GEEN boost, alleen promote/demote

import pool from "../db";
import { emitLog, emitQueue } from "../server";

import { addToQueue, leaveQueue } from "../queue";
import { getOrUpdateUser } from "./2-user-engine";
import { applyBoost, parseBoostChatCommand } from "./7-boost-engine";

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------

function clean(v: any): string {
  return (v || "").toString().trim();
}

function extractCommand(text: string): { cmd: string; args: string[] } | null {
  if (!text.startsWith("!")) return null;
  const parts = text.trim().split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

async function ensureFanStatus(userId: bigint): Promise<boolean> {
  const res = await pool.query(
    `
      SELECT is_fan, fan_expires_at
      FROM users
      WHERE tiktok_id=$1
    `,
    [userId]
  );

  if (!res.rows[0]) return false;

  const { is_fan, fan_expires_at } = res.rows[0];
  if (!is_fan) return false;
  if (!fan_expires_at) return false;

  const now = new Date();
  const exp = new Date(fan_expires_at);

  if (exp <= now) {
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
  console.log("💬 CHAT ENGINE v1.2 LOADED (Join + Boost)");

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
      const usernameClean = user.username;

      const isFan = await ensureFanStatus(dbUserId);

      // ------------------------------------------
      // !join — alleen fans
      // ------------------------------------------
      if (cmd === "!join") {
        if (!isFan) {
          emitLog({
            type: "queue",
            message: `${user.display_name} probeert te joinen maar is geen fan`,
          });
          return;
        }

        await addToQueue(String(userId), usernameClean);
        await emitQueue();

        emitLog({
          type: "queue",
          message: `${user.display_name} staat nu in de wachtrij`,
        });

        return;
      }

      // ------------------------------------------
      // !leave — verlaat queue
      // ------------------------------------------
      if (cmd === "!leave") {
        const refund = await leaveQueue(String(userId));
        await emitQueue();

        emitLog({
          type: "queue",
          message: `${user.display_name} heeft de wachtlijst verlaten (refund ${refund} BP)`,
        });

        return;
      }

      // ------------------------------------------
      // !boost X — BOOST VIA CHAT ONLY
      // ------------------------------------------
      if (cmd === "!boost") {
        const spots = await parseBoostChatCommand(text);
        if (!spots) return;

        const result = await applyBoost(
          String(userId),
          spots,
          user.display_name
        );

        emitLog({
          type: "booster",
          message: `${user.display_name} → ${result.message}`,
        });

        return;
      }

    } catch (err: any) {
      console.error("CHAT ENGINE ERROR:", err?.message || err);
    }
  });
}
