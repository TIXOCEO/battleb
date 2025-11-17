// ============================================================================
// src/server.ts — Undercover BattleBox Engine — v2.10 (Twist-Ready)
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting, setSetting } from "./db";
import { initDB } from "./db";

import { startConnection, stopConnection } from "./engines/1-connection";

// Gift-engine (met twists + BP 20%)
import {
  initGiftEngine,
  initDynamicHost,
  refreshHostUsername,
} from "./engines/3-gift-engine";

// Arena-engine (rondes, eliminaties, ranking, sorting)
import {
  initGame,
  arenaJoin,
  arenaLeave,
  getArena,
  emitArena,
  startRound,
  endRound,
  updateArenaSettings,
  getArenaSettings,
} from "./engines/5-game-engine";

// Queue-engine
import { getQueue, addToQueue } from "./queue";

// Chat-engine incl. twistcommands (!use ...)
import { initChatEngine } from "./engines/6-chat-engine";

// Boost-engine
import { applyBoost } from "./engines/7-boost-engine";

// Twist engines
import {
  useTwist,
  parseUseCommand,
  addTwistByGift,
} from "./engines/8-twist-engine";

import {
  adminGiveTwist,
  adminUseTwist,
  adminGetUserTwists,
} from "./engines/twist-admin-engine";

dotenv.config();

// ============================================================================
// TIKTOK CONNECTION (GLOBAL)
// ============================================================================
export let tiktokConnShared: any = null;

// ============================================================================
// ADMIN TOKEN
// ============================================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ============================================================================
// EXPRESS + HTTP
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// ============================================================================
// GIFT LIST ENDPOINT
// ============================================================================
app.get("/admin/gifts", async (req, res) => {
  try {
    if (!tiktokConnShared) {
      return res.json({
        success: false,
        message: "Geen actieve TikTok-verbinding",
        gifts: [],
      });
    }

    if (typeof tiktokConnShared.getAvailableGifts !== "function") {
      return res.json({
        success: false,
        message: "TikTok-verbinding ondersteunt gift-opvraging niet",
        gifts: [],
      });
    }

    const gifts = await tiktokConnShared.getAvailableGifts();

    return res.json({
      success: true,
      gifts: gifts.map((g: any) => ({
        id: g.id,
        name: g.name,
        diamonds: g.diamond_count,
      })),
    });
  } catch (err: any) {
    return res.json({
      success: false,
      error: err.message,
      gifts: [],
    });
  }
});

// ============================================================================
// SOCKET.IO
// ============================================================================
export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// ============================================================================
// LOGGING
// ============================================================================
type LogEntry = {
  id: string;
  timestamp: string;
  type: string;
  message: string;
};

let currentGameId: number | null = null;

export function getCurrentGameId() {
  return currentGameId;
}

const logBuffer: LogEntry[] = [];
const LOG_MAX = 500;

export function emitLog(log: Partial<LogEntry>) {
  const entry: LogEntry = {
    id: log.id ?? Date.now().toString(),
    timestamp: log.timestamp ?? new Date().toISOString(),
    type: log.type ?? "system",
    message: log.message ?? "",
  };

  logBuffer.unshift(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();

  io.emit("log", entry);
}

// ============================================================================
// QUEUE BROADCASTER
// ============================================================================
export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// ============================================================================
// STREAM STATS
// ============================================================================
export async function broadcastStats() {
  if (!currentGameId) return;

  const statsRes = await pool.query(
    `
      SELECT
        COUNT(DISTINCT CASE WHEN receiver_role IN ('speler','cohost')
          THEN receiver_id END) AS total_players,
        COALESCE(SUM(CASE WHEN receiver_role IN ('speler','cohost')
          THEN diamonds ELSE 0 END), 0) AS total_player_diamonds,
        COALESCE(SUM(CASE WHEN receiver_role = 'host'
          THEN diamonds ELSE 0 END), 0) AS total_host_diamonds
      FROM gifts
      WHERE game_id = $1
    `,
    [currentGameId]
  );

  const row = statsRes.rows[0] || {};

  io.emit("streamStats", {
    totalPlayers: Number(row.total_players || 0),
    totalPlayerDiamonds: Number(row.total_player_diamonds || 0),
    totalHostDiamonds: Number(row.total_host_diamonds || 0),
  });
}

// ============================================================================
// GAME SESSION LOADING
// ============================================================================
async function loadActiveGame() {
  const res = await pool.query(
    `SELECT id FROM games WHERE status='running'
     ORDER BY id DESC LIMIT 1`
  );

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
  } else {
    currentGameId = null;
    console.log("[GAME] Geen actieve game gevonden");
  }
}

// ============================================================================
// TIKTOK CONNECTION MANAGEMENT
// ============================================================================
async function restartTikTokConnection() {
  try {
    if (tiktokConnShared) {
      try {
        await stopConnection(tiktokConnShared);
      } catch {}
      tiktokConnShared = null;
    }

    const host = await getSetting("host_username");

    if (process.env.NODE_ENV === "production" && host) {
      console.log("🔄 TikTok opnieuw verbinden →", host);

      const { conn } = await startConnection(host, () => {});
      tiktokConnShared = conn;

      initGiftEngine(conn);
      initChatEngine(conn);
    } else {
      console.log(
        "Simulatormodus — TikTok connectie overgeslagen (NODE_ENV ≠ production)"
      );
    }
  } catch (err) {
    console.error("❌ TikTok reconnect error:", err);
  }
}

// ============================================================================
// ADMIN SOCKET AUTH
// ============================================================================
interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: any, next) => {
  if (socket.handshake.auth?.token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  next(new Error("Unauthorized"));
});

// ============================================================================
// >>> HERE ENDS SERVER A
// Next: Admin events, game commands, twist admin events, snapshots
// ============================================================================

// ============================================================================
// ADMIN SOCKET EVENTS
// ============================================================================
io.on("connection", (socket: AdminSocket) => {
  if (!socket.isAdmin) {
    socket.disconnect();
    return;
  }

  console.log("🟢 Admin connected");

  // Send initial snapshot
  socket.emit("initialLogs", logBuffer.slice(0, 200));

  socket.on("admin:getInitialSnapshot", async (_, ack) => {
    const queue = await getQueue();
    const arena = getArena();

    ack({
      arena,
      queue: { entries: queue, open: true },
      logs: logBuffer.slice(0, 200),
      stats: null,
      leaderboard: [],
      gameSession: {
        active: Boolean(currentGameId),
        gameId: currentGameId,
      },
    });
  });

  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  // GAME CONTROL
  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  socket.on("admin:startGame", async (_, ack) => {
    try {
      const res = await pool.query(
        `INSERT INTO games (started_at, status)
         VALUES (NOW(), 'running')
         RETURNING id`
      );

      currentGameId = Number(res.rows[0].id);

      emitLog({
        type: "system",
        message: `🎮 Game gestart (#${currentGameId})`,
      });

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:stopGame", async (_, ack) => {
    try {
      if (!currentGameId)
        return ack({ success: false, message: "Geen game actief" });

      await pool.query(
        `UPDATE games SET ended_at = NOW(), status='ended'
         WHERE id=$1`,
        [currentGameId]
      );

      emitLog({
        type: "system",
        message: `🛑 Game gestopt (#${currentGameId})`,
      });

      currentGameId = null;

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  // ROUND CONTROL
  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  socket.on("admin:startRound", async (d, ack) => {
    try {
      const ok = startRound(d.type);
      if (!ok) return ack({ success: false, message: "Kan ronde niet starten" });

      emitLog({
        type: "system",
        message: `▶️ Ronde gestart (${d.type})`,
      });

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:endRound", async (_, ack) => {
    try {
      endRound();

      emitLog({
        type: "system",
        message: `⛔ Ronde beëindigd`,
      });

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  // QUEUE CONTROL
  // ░░░░░░░░░░░░░░░░░░░░░░░░░░░
  socket.on("admin:addToQueue", async (d, ack) => {
    try {
      const username = d.username.replace("@", "");
      await addToQueue(username);

      emitQueue();
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:removeFromQueue", async (d, ack) => {
    try {
      const username = d.username.replace("@", "");
      await pool.query(
        `DELETE FROM queue WHERE LOWER(user_tiktok_id)::text =
         (SELECT tiktok_id::text FROM users WHERE LOWER(username)=LOWER($1))`,
        [username]
      );

      emitQueue();
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // BOOST UP/DOWN
  socket.on("admin:boostUser", async (d, ack) => {
    try {
      await applyBoost(d.username.replace("@", ""), +1);
      emitQueue();
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:demoteUser", async (d, ack) => {
    try {
      await applyBoost(d.username.replace("@", ""), -1);
      emitQueue();
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // Add/remove arena
  socket.on("admin:addToArena", async (d, ack) => {
    try {
      const uname = d.username.replace("@", "");
      const r = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
        [uname]
      );

      if (!r.rows[0])
        return ack({ success: false, message: "Onbekende user" });

      arenaJoin(
        r.rows[0].tiktok_id.toString(),
        r.rows[0].display_name,
        r.rows[0].username.replace("@", "")
      );

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:eliminate", async (d, ack) => {
    try {
      const uname = d.username.replace("@", "");
      const r = await pool.query(
        `SELECT tiktok_id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
        [uname]
      );

      if (!r.rows[0])
        return ack({ success: false, message: "Onbekende user" });

      arenaLeave(r.rows[0].tiktok_id.toString());

      emitArena();

      emitLog({
        type: "elim",
        message: `${d.username} handmatig geëlimineerd`,
      });

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // ========================================================================
  // TWIST ADMIN EVENTS
  // ========================================================================
  socket.on("admin:giveTwist", async (d, ack) => {
    try {
      await adminGiveTwist(d.username, d.twist, d.amount ?? 1);
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:useTwist", async (d, ack) => {
    try {
      await adminUseTwist(d.username, d.twist, d.target ?? null);
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:getUserTwists", async (d, ack) => {
    try {
      const result = await adminGetUserTwists(d.username);
      ack({ success: true, inventory: result });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Admin disconnected");
  });
});

// ============================================================================
// STARTUP SEQUENCE
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();
  await initDynamicHost();

  const host = await getSetting("host_username");

  if (process.env.NODE_ENV === "production" && host) {
    console.log("Connecting TikTok with saved host:", host);
    const { conn } = await startConnection(host, () => {});
    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);
  } else {
    console.log(
      "Simulatormodus — TikTok connectie overgeslagen (NODE_ENV ≠ production)"
    );
  }
});
