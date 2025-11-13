// src/server.ts — Undercover BattleBox Engine — v0.7.0 FINAL
// - Stabiel game-session systeem
// - Foutloze start/stop van games
// - Geen revival van ended games
// - Correcte fallback (alleen running games)
// - Compatibel met gift-engine v0.7.0
// - Minder unknowns door verbeterde identity-updates

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool from "./db";
import { initDB } from "./db";
import { BATTLEBOX_VERSION } from "./version";

import { startConnection } from "./engines/1-connection";
import { getOrUpdateUser } from "./engines/2-user-engine";
import { initGiftEngine } from "./engines/3-gift-engine";
import { addBP } from "./engines/4-points-engine";

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
// Host check
// ─────────────────────────────────────────
if (!process.env.TIKTOK_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ─────────────────────────────────────────
// Express / Socket.io
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
  [key: string]: any;
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
// State
// ─────────────────────────────────────────

let currentGameId: number | null = null; // CRITICAL FOR GIFT ENGINE

const LOG_MAX = 500;
const logBuffer: LogEntry[] = [];

export function getCurrentGameId(): number | null {
  return currentGameId;
}

// ─────────────────────────────────────────
// Emit helpers
// ─────────────────────────────────────────

export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

export function emitLog(
  log: Partial<LogEntry> & { message?: string; type?: string }
) {
  const entry: LogEntry = {
    id: log.id ?? Date.now().toString(),
    timestamp: log.timestamp ?? new Date().toISOString(),
    type: log.type ?? "system",
    message: log.message ?? "(geen bericht)",
    ...log,
  };

  logBuffer.unshift(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();

  io.emit("log", entry);
}

// ─────────────────────────────────────────
// Stats / leaderboard
// ─────────────────────────────────────────

export async function broadcastStats() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )
    `);

    if (!currentGameId)
      return; // Geen actief spel → geen stats tonen

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
  } catch (e: any) {
    console.error("broadcastStats error:", e?.message);
  }
}

// ─────────────────────────────────────────
// Game Session Engine v0.7.0
// ─────────────────────────────────────────

// *** LAAD ACTIEVE GAME (NIET ended) ***
async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id FROM games
    WHERE status = 'running'
    ORDER BY id DESC LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`[GAME] Actieve game geladen → #${currentGameId}`);
  } else {
    currentGameId = null;
    console.log("[GAME] Geen actieve game → klaar om te starten");
  }
}

// *** START NEW GAME ***
async function startNewGame() {
  const res = await pool.query(
    `INSERT INTO games (status)
     VALUES ('running')
     RETURNING id, started_at`
  );

  currentGameId = Number(res.rows[0].id);

  emitLog({
    type: "system",
    message: `Nieuw spel gestart (Game #${currentGameId})`,
  });

  // Reset arena bij nieuw spel
  await arenaClear();

  io.emit("gameSession", {
    active: true,
    gameId: currentGameId,
    startedAt: res.rows[0].started_at,
  });

  await broadcastStats();
}

// *** STOP GAME ***
async function stopCurrentGame() {
  if (!currentGameId) return;

  const gameId = currentGameId;

  await pool.query(
    `UPDATE games
     SET status = 'ended', ended_at = NOW()
     WHERE id = $1`,
    [gameId]
  );

  currentGameId = null; // CRITICAL FIX

  emitLog({
    type: "system",
    message: `Spel beëindigd (Game #${gameId})`,
  });

  io.emit("gameSession", {
    active: false,
    gameId,
    endedAt: new Date().toISOString(),
  });

  await broadcastStats();
}

// ─────────────────────────────────────────
// SOCKETS
// ─────────────────────────────────────────

interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: any, next) => {
  if (socket.handshake.auth?.token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  return next(new Error("Unauthorized"));
});

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN DASHBOARD VERBONDEN:", socket.id);

  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("initialLogs", logBuffer);

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  socket.emit("settings", getArenaSettings());

  await broadcastStats();

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

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
        if (!ok)
          return ack({ success: false, message: "Kon ronde niet starten" });
        return ack({ success: true });
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

      // USER ACTIES
      if (!data?.username)
        return ack({
          success: false,
          message: "username vereist",
        });

      const raw = data.username.trim().replace(/^@/, "");

      const userRes = await pool.query(
        `
        SELECT tiktok_id, display_name, username
        FROM users
        WHERE username ILIKE $1 OR username ILIKE $2
        LIMIT 1
        `,
        [raw, `@${raw}`]
      );

      if (!userRes.rows[0])
        return ack({
          success: false,
          message: `Gebruiker ${raw} niet gevonden`,
        });

      const { tiktok_id, display_name, username } = userRes.rows[0];

      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username, "admin");
          await pool.query("DELETE FROM queue WHERE user_tiktok_id=$1", [
            tiktok_id,
          ]);
          await emitQueue();
          emitArena();
          emitLog({
            type: "join",
            message: `${display_name} → arena`,
          });
          break;

        case "addToQueue":
          await addToQueue(String(tiktok_id), username);
          await emitQueue();
          emitLog({
            type: "join",
            message: `${display_name} → wachtrij`,
          });
          break;

        case "eliminate":
          arenaLeave(String(tiktok_id));
          emitArena();
          emitLog({
            type: "elim",
            message: `${display_name} geëlimineerd`,
          });
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
  socket.on("admin:updateSettings", (d, ack) =>
    handle("updateSettings", d, ack)
  );

  socket.on("admin:addToArena", (d, ack) => handle("addToArena", d, ack));
  socket.on("admin:addToQueue", (d, ack) => handle("addToQueue", d, ack));
  socket.on("admin:eliminate", (d, ack) => handle("eliminate", d, ack));
  socket.on("admin:removeFromQueue", (d, ack) =>
    handle("removeFromQueue", d, ack)
  );
});

// ─────────────────────────────────────────
// REST
// ─────────────────────────────────────────

app.post("/api/admin/:action", (_req, res) =>
  res.json({ success: true })
);

// ─────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────

initDB().then(async () => {
  server.listen(4000, () => {
  console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
});

  // INIT arena
  initGame();

  // CRITICAL: alleen actieve games laden
  await loadActiveGame();

  await broadcastStats();

  const { conn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );

  initGiftEngine(conn);
});
