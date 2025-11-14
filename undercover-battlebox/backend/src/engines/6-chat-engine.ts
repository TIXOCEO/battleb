// src/engines/6-chat-engine.ts
// CHAT ENGINE — v1.1 (Simplified)
// Functies:
//  - Heart Me gift → fan voor 24 uur
//  - Alleen fans mogen !join gebruiken
//  - !join zet speler ALLEEN in de queue
//  - Geen autoplacement in arena
//  - Geen boosters (!boost) meer
//  - Geen !leave refund? → blijft bestaan of wil je ook weg? (momenteel behouden)
//
// Imports & dependency engines
import pool from "../db";
import { emitLog, emitQueue } from "../server";

import { addToQueue, leaveQueue } from "../queue";
import { getOrUpdateUser } from "./2-user-engine";

// -------------------------------------------
// Helper functions
// -------------------------------------------

function clean(value: any): string {
  return (value || "").toString().trim();
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
      WHERE tiktok_id = $1
    `,
    [userId]
  );

  if (!res.rows[0]) return false;

  const { is_fan, fan_expires_at } = res.rows[0];

  if (!is_fan) return false;
  if (!fan_expires_at) return false;

  const now = new Date();
  const expiry = new Date(fan_expires_at);

  if (expiry <= now) {
    // verlopen → reset
    await pool.query(
      `UPDATE users SET is_fan = FALSE, fan_expires_at = NULL WHERE tiktok_id = $1`,
      [userId]
    );
    return false;
  }

  return true;
}

// -------------------------------------------
// MAIN ENGINE
// -------------------------------------------

export function initChatEngine(conn: any) {
  console.log("💬 CHAT ENGINE v1.1 LOADED (simplified)");

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

      const { cmd, args } = command;

      const user = await getOrUpdateUser(
        String(userId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      const dbUserId = BigInt(userId);
      const usernameClean = user.username;

      const isFan = await ensureFanStatus(dbUserId);

      // -----------------------------------
      // !join — alleen voor fans
      // -----------------------------------
      if (cmd === "!join") {
        if (!isFan) {
          emitLog({
            type: "queue",
            message: `${user.display_name} probeert te joinen, maar is geen fan`,
          });
          return;
        }

        await addToQueue(String(userId), usernameClean);
        await emitQueue();

        emitLog({
          type: "queue",
          message: `${user.display_name} heeft zich bij de wachtlijst gevoegd`,
        });

        return;
      }

      // -----------------------------------
      // !leave — queue verlaten
      // (refund mechanisme van leaveQueue blijft actief)
      // -----------------------------------
      if (cmd === "!leave") {
        const refund = await leaveQueue(String(userId));
        await emitQueue();

        emitLog({
          type: "queue",
          message: `${user.display_name} heeft de wachtrij verlaten (refund ${refund} BP)`,
        });

        return;
      }

      // -----------------------------------
      // !boost — VERWIJDERD
      // -----------------------------------
      if (cmd === "!boost") {
        emitLog({
          type: "system",
          message: `${user.display_name} probeert !boost te gebruiken → boost is uitgeschakeld`,
        });
        return;
      }

    } catch (err: any) {
      console.error("CHAT ENGINE ERROR:", err?.message || err);
    }
  });
}
