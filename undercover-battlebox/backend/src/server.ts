// ============================================================================
// server.ts — Undercover BattleBox Engine — v3.2 (Stable Build)
// ============================================================================
//
// ✔ Admin kan GEEN users aanmaken
// ✔ addToArena en addToQueue werken alleen met bestaande DB users
// ✔ Nieuwe addToQueue(tiktok_id) signature correct toegepast
// ✔ TikTok connectie null-safe en clean
// ✔ Geen dubbele event handlers meer
// ✔ Geen invalid bigint errors
// ✔ admin search API blijft werken
// ✔ parseUseCommand gefixt (!use)
// ✔ Gift-engine, Chat-engine, Twist-engine compatible
//
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting } from "./db";
import { initDB } from "./db";

// Engines
import { startConnection, stopConnection } from "./engines/1-connection";
import { initGiftEngine, initDynamicHost } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";
import {
  arenaJoin,
  getArena,
  emitArena,
  startRound,
  endRound,
} from "./engines/5-game-engine";

import { getQueue, addToQueue } from "./queue";
import { parseUseCommand } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { getOrUpdateUser } from "./engines/2-user-engine";

dotenv.config();

// ============================================================================
// GLOBALS
// ============================================================================
export let tiktokConnShared: any = null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";
let currentGameId: number | null = null;

// ============================================================================
// EXPRESS + SOCKET.IO
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

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
// STREAM STATS
// ============================================================================
export async function broadcastStats() {
  if (!currentGameId) return;

  const q = await pool.query(
    `
    SELECT
      COUNT(DISTINCT CASE WHEN receiver_role IN ('speler','cohost')
        THEN receiver_id END) AS total_players,
      COALESCE(SUM(CASE WHEN receiver_role IN ('speler','cohost')
        THEN diamonds ELSE 0 END), 0) AS total_player_diamonds,
      COALESCE(SUM(CASE WHEN receiver_role='host'
        THEN diamonds ELSE 0 END), 0) AS total_host_diamonds
    FROM gifts
    WHERE game_id=$1
  `,
    [currentGameId]
  );

  io.emit("streamStats", {
    totalPlayers: Number(q.rows[0]?.total_players || 0),
    totalPlayerDiamonds: Number(q.rows[0]?.total_player_diamonds || 0),
    totalHostDiamonds: Number(q.rows[0]?.total_host_diamonds || 0),
  });
}

// ============================================================================
// LOAD ACTIVE GAME
// ============================================================================
async function loadActiveGame() {
  const r = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  if (r.rows.length) {
    currentGameId = r.rows[0].id;
    console.log(`✓ Actieve game geladen (#${currentGameId})`);
  } else {
    console.log("ℹ Geen actieve game.");
    currentGameId = null;
  }
}

// ============================================================================
// TIKTOK CONNECTION (idle wanneer offline)
// ============================================================================
async function restartTikTokConnection() {
  const host = await getSetting("host_username");

  if (!host) {
    console.log("⚠ Geen host ingesteld → Idle mode");
    tiktokConnShared = null;
    return;
  }

  console.log("🔄 TikTok reconnect voor host:", host);

  if (tiktokConnShared) {
    try {
      await stopConnection(tiktokConnShared);
    } catch {}
  }
  tiktokConnShared = null;

  try {
    const { conn } = await startConnection(host, () => {});
    if (!conn) {
      console.log("❌ Geen conn object → idle mode");
      return;
    }

    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    conn.on("chat", async (msg: any) => {
      const senderId =
        msg.user?.userId ||
        msg.sender?.userId ||
        msg.userId ||
        msg.uid;

      if (!senderId) return;

      const text = msg.comment || msg.text || msg.content || "";
      const clean = text.trim().toLowerCase();

      if (!clean.startsWith("!use ")) return;

      const sender = await getOrUpdateUser(
        String(senderId),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      await parseUseCommand(sender.id, sender.display_name, clean);
    });
  } catch (err: any) {
    console.log("⛔ Host offline:", err?.message);
    console.log("⏳ Idle mode until new host is set.");
    tiktokConnShared = null;
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
    next();
  } else next(new Error("Unauthorized"));
});

// ============================================================================
// ADMIN SEARCH API (HTTP)
// ============================================================================
app.get("/admin/searchUsers", async (req, res) => {
  const q = String(req.query.query || "").trim().toLowerCase();

  if (!q || q.length < 2)
    return res.json({ users: [] });

  const r = await pool.query(
    `
    SELECT tiktok_id, username, display_name
    FROM users
    WHERE LOWER(username) LIKE $1
       OR LOWER(display_name) LIKE $2
    ORDER BY last_seen_at DESC
    LIMIT 20
  `,
    [`${q}%`, `%${q}%`]
  );

  res.json({ users: r.rows });
});

// ============================================================================
// ADMIN SOCKET
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return;

  console.log("✓ Admin verbonden:", socket.id);

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

  initAdminTwistEngine(socket);

  // search autocomplete
  socket.on("admin:searchUsers", async ({ query }, ack) => {
    const q = String(query || "").trim().toLowerCase();
    if (!q || q.length < 2) return ack({ users: [] });

    const r = await pool.query(
      `
      SELECT tiktok_id, username, display_name
      FROM users
      WHERE LOWER(username) LIKE $1
         OR LOWER(display_name) LIKE $2
      ORDER BY last_seen_at DESC
      LIMIT 20
    `,
      [`${q}%`, `%${q}%`]
    );

    ack({ users: r.rows });
  });

  // GAME START
  socket.on("admin:startGame", async (_, ack) => {
    try {
      const r = await pool.query(
        `INSERT INTO games(status, started_at)
         VALUES('running', NOW())
         RETURNING id`
      );

      currentGameId = r.rows[0].id;

      io.emit("gameSession", {
        active: true,
        gameId: currentGameId,
      });

      emitLog({
        type: "system",
        message: `Game #${currentGameId} gestart.`,
      });

      ack({ success: true });
    } catch (e: any) {
      ack({ success: false, message: e.message });
    }
  });

  // GAME STOP
  socket.on("admin:stopGame", async (_, ack) => {
    if (!currentGameId)
      return ack({ success: false, message: "Geen actief spel" });

    await pool.query(
      `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1`,
      [currentGameId]
    );

    emitLog({
      type: "system",
      message: `Game #${currentGameId} beëindigd.`,
    });

    currentGameId = null;

    io.emit("gameSession", { active: false, gameId: null });
    ack({ success: true });
  });

  // HOST SETTEN
  socket.on("admin:setHost", async ({ username }, ack) => {
    try {
      if (!username?.trim())
        return ack({ success: false, message: "Ongeldige host" });

      const clean = username.trim().replace(/^@/, "");

      await pool.query(
        `INSERT INTO settings(key, value)
         VALUES('host_username', $1)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        [clean]
      );

      io.emit("host", clean);
      emitLog({
        type: "admin",
        message: `Host aangepast naar @${clean}`,
      });

      restartTikTokConnection();

      ack({ success: true });
    } catch (e: any) {
      ack({ success: false, message: e.message });
    }
  });

  // START / END ROUND
  socket.on("admin:startRound", ({ type }, ack) => {
    const ok = startRound(type);
    ack({
      success: ok,
      message: ok ? "Ronde gestart." : "Kon ronde niet starten.",
    });
  });

  socket.on("admin:endRound", (_, ack) => {
    endRound();
    ack({ success: true });
  });

  // ADD TO ARENA
  socket.on("admin:addToArena", async ({ username }, ack) => {
    try {
      const clean = username.replace("@", "").toLowerCase();

      const r = await pool.query(
        `
        SELECT tiktok_id, display_name, username
        FROM users
        WHERE LOWER(username)=LOWER($1)
        LIMIT 1
      `,
        [clean]
      );

      if (!r.rows.length)
        return ack({ success: false, message: "User niet gevonden" });

      const u = r.rows[0];

      arenaJoin(String(u.tiktok_id), u.display_name, u.username);
      ack({ success: true });
    } catch (e: any) {
      ack({ success: false, message: e.message });
    }
  });

  // ADD TO QUEUE (fixed → only tiktok_id)
  socket.on("admin:addToQueue", async ({ username }, ack) => {
    try {
      const clean = username.replace("@", "").toLowerCase();

      const r = await pool.query(
        `
        SELECT tiktok_id
        FROM users
        WHERE LOWER(username)=LOWER($1)
        LIMIT 1
      `,
        [clean]
      );

      if (!r.rows.length)
        return ack({
          success: false,
          message: "User bestaat niet (nog nooit TikTok events ontvangen).",
        });

      const u = r.rows[0];

      await addToQueue(String(u.tiktok_id));

      io.emit("updateQueue", {
        open: true,
        entries: await getQueue(),
      });

      ack({ success: true });
    } catch (e: any) {
      ack({ success: false, message: e.message });
    }
  });
});

// ============================================================================
// EXPORTS
// ============================================================================
export { emitArena };

// ============================================================================
// STARTUP
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  await loadActiveGame();
  await initDynamicHost();

  const host = await getSetting("host_username");
  if (host) restartTikTokConnection();
  else console.log("⏸ Idle mode — geen host ingesteld.");
});
