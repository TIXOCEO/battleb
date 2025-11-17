// ============================================================================
// server.ts — Undercover BattleBox Engine — v2.40 (Stable / Idle Mode / Host Swap)
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting } from "./db";
import { initDB } from "./db";

// TikTok connection engine
import { startConnection, stopConnection } from "./engines/1-connection";

// Gift engine
import {
  initGiftEngine,
  initDynamicHost,
} from "./engines/3-gift-engine";

// Arena engine
import {
  initGame,
  arenaJoin,
  getArena,
  emitArena,
  startRound,
  endRound,
} from "./engines/5-game-engine";

// Queue
import { getQueue, addToQueue } from "./queue";

// Chat engine (!join / !boost / !use passthrough)
import { initChatEngine } from "./engines/6-chat-engine";

// Twist engine (!use)
import { parseUseCommand } from "./engines/8-twist-engine";

// Admin twist engine
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";

// Users
import { getOrUpdateUser } from "./engines/2-user-engine";

// Load ENV
dotenv.config();

// ============================================================================
// SHARED TIKTOK CONNECTION
// ============================================================================
export let tiktokConnShared: any = null;

// ============================================================================
// ADMIN AUTH
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
// GIFTS ENDPOINT
// ============================================================================
app.get("/admin/gifts", async (req, res) => {
  try {
    if (
      !tiktokConnShared ||
      typeof tiktokConnShared.getAvailableGifts !== "function"
    ) {
      return res.json({
        success: false,
        message: "Geen TikTok connectie actief",
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
// SOCKET.IO INIT
// ============================================================================
export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// ============================================================================
// LOGGING BUFFER
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
// QUEUE NOTIFY
// ============================================================================
export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
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
    console.log(`[GAME] Actieve game: #${currentGameId}`);
  } else {
    console.log("[GAME] Geen actief spel gevonden");
    currentGameId = null;
  }
}

// ============================================================================
// TIKTOK RECONNECT — SAFE MODE
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

    if (!host) {
      console.log("⚠ Geen host ingesteld → TikTok idle mode");
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("Simulatie-modus — TikTok connectie niet gemaakt");
      return;
    }

    console.log("🔄 Verbinden met TikTok host:", host);

    const { conn } = await startConnection(host, () => {});

    if (!conn) {
      console.log(`⚠ Host @${host} offline → TikTok engine in IDLE-modus`);
      tiktokConnShared = null;
      return;
    }

    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    // Twist commands
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
      if (!clean.startsWith("!use")) return;

      const sender = await getOrUpdateUser(
        String(senderId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      await parseUseCommand(sender.id, sender.display_name, clean);
    });

    console.log("✔ TikTok connectie actief");

  } catch (err) {
    console.error("❌ Fout in restartTikTokConnection:", err);
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
// ADMIN SOCKET EVENTS
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return;

  console.log("Admin verbonden");

  // Initial snapshot
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

  // Twist-admin events
  initAdminTwistEngine(socket);

  // ====================================================================
  // ADMIN: HOST INSTELLEN
  // ====================================================================
  socket.on("admin:setHost", async ({ username }, ack: Function) => {
    try {
      const clean = username.trim().replace(/^@/, "");
      if (!clean)
        return ack({ success: false, message: "Lege username" });

      await pool.query(
        `INSERT INTO settings(key,value)
         VALUES ('host_username',$1)
         ON CONFLICT(key) DO UPDATE SET value=$1`,
        [clean]
      );

      io.emit("host", clean);

      await restartTikTokConnection();

      ack({ success: true, host: clean });
      console.log("✔ Nieuwe host ingesteld:", clean);
      
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // ====================================================================
  // START GAME
  // ====================================================================
  socket.on("admin:startGame", async (_, ack: Function) => {
    try {
      const res = await pool.query(
        `INSERT INTO games(status, started_at)
         VALUES('running', NOW())
         RETURNING id`
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

  // ====================================================================
  // STOP GAME
  // ====================================================================
  socket.on("admin:stopGame", async (_, ack: Function) => {
    try {
      if (!currentGameId)
        return ack({ success: false, message: "Geen actief spel" });

      await pool.query(
        `UPDATE games
         SET status='ended', ended_at=NOW()
         WHERE id=$1`,
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

  // ====================================================================
  // Ronde-controls
  // ====================================================================
  socket.on("admin:startRound", ({ type }, ack: Function) => {
    const ok = startRound(type);
    ack({
      success: ok,
      message: ok ? "Ronde gestart." : "Kon ronde niet starten.",
    });
  });

  socket.on("admin:endRound", (_, ack: Function) => {
    endRound();
    ack({ success: true });
  });

  // ====================================================================
  // Arena: speler toevoegen
  // ====================================================================
  socket.on("admin:addToArena", async ({ username }, ack: Function) => {
    try {
      const res = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users
         WHERE LOWER(username)=LOWER($1)
         LIMIT 1`,
        [username.replace("@", "")]
      );

      if (!res.rows[0])
        return ack({
          success: false,
          message: "Speler niet gevonden",
        });

      const u = res.rows[0];

      arenaJoin(
        String(u.tiktok_id),
        u.display_name,
        u.username.replace("@", "")
      );

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });
});

// ============================================================================
// EXPORT emitArena
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

  // TikTok connectie laden
  await restartTikTokConnection();
});
