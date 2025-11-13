// src/server.ts — Undercover BattleBox Engine — v1.1 Settings-Enabled

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool from "./db";
import { initDB } from "./db";

import { BATTLEBOX_VERSION } from "./version";

import { startConnection } from "./engines/1-connection";
import { initGiftEngine } from "./engines/3-gift-engine";

import {
  initGame,
  arenaJoin,
  arenaLeave,
  arenaClear,
  getArena,
  emitArena,
  startRound,
  endRound,
  updateArenaSettings,
  getArenaSettings,
} from "./engines/5-game-engine";

import { getQueue, addToQueue } from "./queue";

dotenv.config();

// ─────────────────────────────────────────
// ADMIN TOKEN
// ─────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ─────────────────────────────────────────
// Express + Socket.IO
// ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

type LogEntry = {
  id: string;
  timestamp: string;
  type: string;
  message: string;
};

type StreamStats = {
  totalPlayers: number;
  totalPlayerDiamonds: number;
  totalHostDiamonds: number;
};

type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  username: string;
  total_diamonds: number;
};

type GameSessionState = {
  active: boolean;
  gameId: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

// ─────────────────────────────────────────
// Global state
// ─────────────────────────────────────────

let currentGameId: number | null = null;

export function getCurrentGameId() {
  return currentGameId;
}

const LOG_MAX = 500;
const logBuffer: LogEntry[] = [];

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

export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// STREAM STATS + LEADERBOARD
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

  const stats: StreamStats = {
    totalPlayers: Number(row.total_players || 0),
    totalPlayerDiamonds: Number(row.total_player_diamonds || 0),
    totalHostDiamonds: Number(row.total_host_diamonds || 0),
  };

  const lbRes = await pool.query(
    `
      SELECT receiver_id, receiver_username, receiver_display_name,
             COALESCE(SUM(diamonds), 0) AS total_diamonds
      FROM gifts
      WHERE game_id = $1 AND receiver_role IN ('speler','cohost')
      GROUP BY receiver_id, receiver_username, receiver_display_name
      ORDER BY total_diamonds DESC
      LIMIT 50
    `,
    [currentGameId]
  );

  const leaderboard = lbRes.rows.map((r: any) => ({
    user_id: r.receiver_id ? String(r.receiver_id) : "",
    display_name: r.receiver_display_name,
    username: (r.receiver_username || "").replace(/^@/, ""),
    total_diamonds: Number(r.total_diamonds || 0),
  }));

  io.emit("streamStats", stats);
  io.emit("streamLeaderboard", leaderboard);
}

// ─────────────────────────────────────────
// Game session logic
// ─────────────────────────────────────────

async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`[GAME] Actieve game geladen → #${currentGameId}`);
  } else {
    currentGameId = null;
    console.log("[GAME] Geen actieve game beschikbaar");
  }
}

async function startNewGame() {
  const res = await pool.query(`
    INSERT INTO games (status)
    VALUES ('running')
    RETURNING id, started_at
  `);

  currentGameId = Number(res.rows[0].id);

  emitLog({ type: "system", message: `Nieuw spel gestart (Game #${currentGameId})` });

  await arenaClear();
  io.emit("gameSession", {
    active: true,
    gameId: currentGameId,
    startedAt: res.rows[0].started_at,
  });

  await broadcastStats();
}

async function stopCurrentGame() {
  if (!currentGameId) return;

  await pool.query(
    `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1`,
    [currentGameId]
  );

  emitLog({
    type: "system",
    message: `Spel beëindigd (Game #${currentGameId})`,
  });

  io.emit("gameSession", {
    active: false,
    gameId: currentGameId,
    endedAt: new Date().toISOString(),
  });

  currentGameId = null;

  await broadcastStats();
}

// ─────────────────────────────────────────
// ADMIN SOCKET
// ─────────────────────────────────────────

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

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN DASHBOARD CONNECT:", socket.id);

  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("initialLogs", logBuffer);
  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  // 🔥 NIEUW: settings naar client
  socket.emit("settings", getArenaSettings());

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  // ACTION HANDLER
  const handle = async (action: string, data: any, ack: Function) => {
    try {
      if (action === "startGame") {
        if (currentGameId)
          return ack({ success: false, message: "Er draait al een spel" });
        await startNewGame();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId)
          return ack({ success: false, message: "Geen actief spel" });
        await stopCurrentGame();
        return ack({ success: true });
      }

      if (action === "startRound") {
        const ok = startRound(data?.type || "quarter");
        return ack(ok ? { success: true } : { success: false, message: "Ronde kon niet starten" });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      if (action === "updateSettings") {
        await updateArenaSettings({
          roundDurationPre: Number(data?.roundDurationPre),
          roundDurationFinal: Number(data?.roundDurationFinal),
          graceSeconds: Number(data?.graceSeconds),
        });

        io.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

      // USER-acties
      if (!data?.username)
        return ack({ success: false, message: "username vereist" });

      const raw = data.username.trim().replace(/^@/, "");

      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users WHERE username ILIKE $1 OR username ILIKE $2 LIMIT 1`,
        [raw, `@${raw}`]
      );

      if (!userRes.rows[0])
        return ack({ success: false, message: `Gebruiker ${raw} niet gevonden` });

      const { tiktok_id, display_name, username } = userRes.rows[0];

      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username);
          await pool.query("DELETE FROM queue WHERE user_tiktok_id=$1", [
            tiktok_id,
          ]);
          await emitQueue();
          emitArena();
          emitLog({ type: "join", message: `${display_name} → arena` });
          break;

        case "addToQueue":
          await addToQueue(String(tiktok_id), username);
          await emitQueue();
          emitLog({ type: "join", message: `${display_name} → wachtrij` });
          break;

        case "eliminate":
          arenaLeave(String(tiktok_id));
          emitArena();
          emitLog({ type: "elim", message: `${display_name} geëlimineerd` });
          break;

        case "removeFromQueue":
          await pool.query("DELETE FROM queue WHERE user_tiktok_id=$1", [
            tiktok_id,
          ]);
          await emitQueue();
          emitLog({
            type: "elim",
            message: `${display_name} verwijderd uit wachtrij`,
          });
          break;
      }

      return ack({ success: true });
    } catch (err: any) {
      console.error("Admin error:", err);
      return ack({
        success: false,
        message: err.message || "Server error",
      });
    }
  };

  socket.on("admin:startGame", (d, ack) => handle("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handle("stopGame", d, ack));
  socket.on("admin:startRound", (d, ack) => handle("startRound", d, ack));
  socket.on("admin:endRound", (d, ack) => handle("endRound", d, ack));
  socket.on("admin:updateSettings", (d, ack) => handle("updateSettings", d, ack));
  socket.on("admin:addToArena", (d, ack) => handle("addToArena", d, ack));
  socket.on("admin:addToQueue", (d, ack) => handle("addToQueue", d, ack));
  socket.on("admin:eliminate", (d, ack) => handle("eliminate", d, ack));
  socket.on("admin:removeFromQueue", (d, ack) => handle("removeFromQueue", d, ack));
});

// ─────────────────────────────────────────
// REST ENDPOINT (placeholder)
// ─────────────────────────────────────────

app.post("/api/admin/:action", (_req, res) => {
  res.json({ success: true });
});

// ─────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────

initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();
  await broadcastStats();

  const { conn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );

  initGiftEngine(conn);
});
