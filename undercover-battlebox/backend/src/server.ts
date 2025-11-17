// ============================================================================
// server.ts — Undercover BattleBox Engine — v2.12 (Twist Stable Build)
// ============================================================================
//
// Geïntegreerde componenten:
//   - Gift Engine + Fanclub + Diamonds
//   - Chat Engine (!join, !leave, !boost, !use <twist>)
//   - Twist Engine (bestand 8)
//   - Twist Inventory (bestand 2)
//   - Admin Twist Controls (bestand 9)
//   - Queue Engine
//   - Arena Engine (bestand 5)
//
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting } from "./db";
import { initDB } from "./db";

// TikTok connectie
import { startConnection, stopConnection } from "./engines/1-connection";

// Gift engine
import {
  initGiftEngine,
  initDynamicHost,
  refreshHostUsername,
} from "./engines/3-gift-engine";

// Arena / Game engine
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

// Queue
import { getQueue, addToQueue } from "./queue";

// Chat engine (join/boost + !use passthrough)
import { initChatEngine } from "./engines/6-chat-engine";

// BP Boost Engine
import { applyBoost } from "./engines/7-boost-engine";

// Twist engine (!use)
import { parseUseCommand } from "./engines/8-twist-engine";

// Admin twist engine
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";

// User resolve
import { getOrUpdateUser } from "./engines/2-user-engine";

// ENV
dotenv.config();

// ============================================================================
// TIKTOK CONNECTION SHARED
// ============================================================================
export let tiktokConnShared: any = null;

// ============================================================================
// ADMIN AUTH
// ============================================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ============================================================================
// EXPRESS SERVER
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// ============================================================================
// EASY GIFT LIST ENDPOINT
// ============================================================================
app.get("/admin/gifts", async (req, res) => {
  try {
    if (!tiktokConnShared || typeof tiktokConnShared.getAvailableGifts !== "function") {
      return res.json({
        success: false,
        message: "Geen geldige TikTok connectie",
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
export type LogEntry = {
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
const LOG_MAX = 600;

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
// QUEUE UPDATES
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
// LOAD ACTIVE GAME
// ============================================================================
async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC
    LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
  } else {
    console.log("[GAME] Geen actieve game gevonden");
    currentGameId = null;
  }
}

// ============================================================================
// TIKTOK CONNECTION HANDLER
// ============================================================================
async function restartTikTokConnection() {
  try {
    if (tiktokConnShared) {
      try { await stopConnection(tiktokConnShared); } catch {}
      tiktokConnShared = null;
    }

    const host = await getSetting("host_username");

    if (process.env.NODE_ENV === "production" && host) {
      console.log("🔄 TikTok opnieuw verbinden met host:", host);

      const { conn } = await startConnection(host, () => {});
      tiktokConnShared = conn;

      initGiftEngine(conn);
      initChatEngine(conn);

      // Twist chat detectie (!use)
      conn.on("chat", async (msg: any) => {
        const senderId =
          msg.user?.userId ||
          msg.sender?.userId ||
          msg.userId ||
          msg.uid;

        if (!senderId) return;

        const text =
          msg.comment ||
          msg.text ||
          msg.content ||
          "";

        const clean = text.trim().toLowerCase();
        if (!clean.startsWith("!use ")) return;

        const sender = await getOrUpdateUser(
          String(senderId),
          msg.user?.nickname || msg.sender?.nickname,
          msg.user?.uniqueId || msg.sender?.uniqueId
        );

        await parseUseCommand(
          sender.id,
          sender.display_name,
          clean
        );
      });

    } else {
      console.log("Simulatormodus — TikTok connectie overgeslagen.");
    }
  } catch (err) {
    console.error("❌ TikTok reconnect error:", err);
  }
}

// ============================================================================
// ADMIN AUTH
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
// ADMIN SOCKET EVENTS
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return;

  console.log("Admin verbonden");

  // Snapshot initial
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", {
    open: true,
    entries: await getQueue(),
  });
  socket.emit("gameSession", {
    active: !!currentGameId,
    gameId: currentGameId,
  });

  // -------------------
  // Admin twist engine
  // -------------------
  initAdminTwistEngine(socket);

  // -------------------
  // ADMIN CONTROLS
  // -------------------

  socket.on("admin:startGame", async (_, ack: Function) => {
    try {
      const res = await pool.query(
        `INSERT INTO games(status, started_at) VALUES('running', NOW()) RETURNING id`
      );
      currentGameId = Number(res.rows[0].id);

      ack({ success: true });
      io.emit("gameSession", {
        active: true,
        gameId: currentGameId,
      });
      emitLog({
        type: "system",
        message: `Game #${currentGameId} gestart.`,
      });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:stopGame", async (_, ack: Function) => {
    try {
      if (!currentGameId)
        return ack({ success: false, message: "Geen actief spel" });

      await pool.query(
        `
        UPDATE games
        SET status='ended', ended_at=NOW()
        WHERE id=$1
      `,
        [currentGameId]
      );

      ack({ success: true });
      emitLog({
        type: "system",
        message: `Game #${currentGameId} beëindigd.`,
      });

      currentGameId = null;
      io.emit("gameSession", { active: false, gameId: null });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // -------------------
  // Ronde controls
  // -------------------
  socket.on("admin:startRound", async ({ type }, ack: Function) => {
    const ok = startRound(type);
    ack({
      success: ok,
      message: ok ? "Ronde gestart." : "Kon ronde niet starten.",
    });
  });

  socket.on("admin:endRound", async (_, ack: Function) => {
    endRound();
    ack({ success: true });
  });

  // -------------------
  // Arena controls
  // -------------------
  socket.on("admin:addToArena", async ({ username }, ack: Function) => {
    try {
      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
        [username.replace("@", "")]
      );

      if (!userRes.rows[0])
        return ack({ success: false, message: "Niet gevonden" });

      const u = userRes.rows[0];

      arenaJoin(
        u.tiktok_id.toString(),
        u.display_name,
        u.username.replace("@", "")
      );

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  socket.on("admin:addToQueue", async ({ username }, ack: Function) => {
    try {
      await addToQueue(username.replace("@", ""), username.replace("@", ""));
      await emitQueue();
      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });
});

// ============================================================================
// EXPORT emitArena (BELANGRIJK!)
// ============================================================================
export { emitArena };

// ============================================================================
// STARTUP
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

    // Twist chat detectie
    conn.on("chat", async (msg: any) => {
      const senderId =
        msg.user?.userId ||
        msg.sender?.userId ||
        msg.userId ||
        msg.uid;

      if (!senderId) return;

      const text =
        msg.comment || msg.text || msg.content || "";

      const clean = text.trim().toLowerCase();
      if (!clean.startsWith("!use")) return;

      const sender = await getOrUpdateUser(
        String(senderId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      await parseUseCommand(
        sender.id,
        sender.display_name,
        clean
      );
    });

  } else {
    console.log("Simulatormodus — TikTok connectie overgeslagen.");
  }
});
