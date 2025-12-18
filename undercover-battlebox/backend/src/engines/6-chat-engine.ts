// ============================================================================
// 6-chat-engine.ts — v16 (Danny Build) — Queue v16 Compatible
// ----------------------------------------------------------------------------
// ✔ FAN-only join
// ✔ Host join only offline
// ✔ Uses Queue v16 (addToQueue / leaveQueue / pushQueueUpdate)
// ✔ All old direct sorting removed (queue.ts handles everything)
// ✔ Boost intact
// ✔ Twists intact
// ✔ Extreme stability, minimal edits
// ============================================================================

import pool from "../db";
import { io, emitLog, getActiveHost, isStreamLive } from "../server";

import { addToQueue, leaveQueue, getQueue, pushQueueUpdate } from "../queue";
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

// FAN-check: 24h geldigheid + auto-expire
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
  const now = new Date();

  if (exp <= now) {
    await pool.query(
      `UPDATE users SET is_fan=FALSE, fan_expires_at=NULL WHERE tiktok_id=$1`,
      [userId]
    );
    return false;
  }

  return true;
}

// ============================================================================
// MAIN ENGINE
// ============================================================================
export function initChatEngine(conn: any) {
  console.log("💬 CHAT ENGINE v16 LOADED");

  conn.on("chat", async (msg: any) => {
    try {
      const userId =
        msg.user?.userId ||
        msg.sender?.userId ||
        msg.userId ||
        msg.uid;

      if (!userId) return;

      const rawText =
        msg.comment ||
        msg.text ||
        msg.content ||
        "";

      const text = clean(rawText);
      if (!text.startsWith("!")) return;

      const command = extractCommand(text);
      if (!command) return;

      const { cmd } = command;

      // sync user
      const user = await getOrUpdateUser(
        String(userId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      const dbUserId = BigInt(userId);

      // FAN CHECK
      const fan = await ensureFanStatus(dbUserId);

      // VIP CHECK
      const vipRow = await pool.query(
        `SELECT is_vip FROM users WHERE tiktok_id=$1`,
        [dbUserId]
      );
      const isVip = vipRow.rows[0]?.is_vip ? true : false;

      const tag = isVip ? "[VIP] " : fan ? "[FAN] " : "";

      // HOST CHECK
      const activeHost = getActiveHost();
      const isHost =
        activeHost && String(activeHost.id) === String(userId);

      // =====================================================================
      // !join
      // =====================================================================
      if (cmd === "!join") {
        // host mag joinen als stream NIET live is
        if (isHost && !isStreamLive()) {
          await addToQueue(String(userId), user.username);
          await pushQueueUpdate();

          emitLog({
            type: "queue",
            message: `[HOST] ${user.display_name} staat nu in de wachtrij.`,
          });

          return;
        }

        // host tijdens livestream → verboden
        if (isHost && isStreamLive()) {
          emitLog({
            type: "queue",
            message: `[HOST] ${user.display_name} mag niet joinen tijdens livestream.`,
          });
          return;
        }

        // FAN ONLY (spelers)
        if (!fan) {
          emitLog({
            type: "queue",
            message: `${user.display_name} probeerde te joinen maar is geen fan.`,
          });
          return;
        }

        await addToQueue(String(userId), user.username);
        await pushQueueUpdate();

        emitLog({
          type: "queue",
          message: `${tag}${user.display_name} staat nu in de wachtrij.`,
        });

        return;
      }

      // =====================================================================
      // !leave
      // =====================================================================
      if (cmd === "!leave") {
        const refund = await leaveQueue(String(userId));

        await pushQueueUpdate();

        emitLog({
          type: "queue",
          message: `${tag}${user.display_name} heeft de queue verlaten (refund ${refund} BP).`,
        });

        return;
      }

      // =====================================================================
      // !boost X
      // =====================================================================
      if (cmd === "!boost") {
        const spots = await parseBoostChatCommand(text);
        if (!spots) return;

        try {
          const result = await applyBoost(
            String(userId),
            spots,
            user.display_name
          );

          await pushQueueUpdate();

          emitLog({
            type: "boost",
            message: `${tag}${user.display_name}: ${result.message}`,
          });
        } catch (err: any) {
          emitLog({
            type: "boost",
            message: err.message,
          });
        }

        return;
      }

      // =====================================================================
      // !use <twist> [target]
      // =====================================================================
      if (cmd === "!use") {
await parseUseCommand(
  String(userId),
  user.display_name,
  text   // 👈 GECLEANDE COMMAND STRING
);
        return;
      }

    } catch (err: any) {
      console.error("CHAT ENGINE ERROR:", err?.message || err);
    }
  });
}
