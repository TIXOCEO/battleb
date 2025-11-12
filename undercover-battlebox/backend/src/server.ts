// src/server.ts — BATTLEBOX ENGINE – GAME MANAGEMENT, ADMIN DASHBOARD, STATS

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import { initDB } from "./db";
import { BATTLEBOX_VERSION } from "./version";
import pool from "./db";
import cors from "cors";
import dotenv from "dotenv";

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
import { addToQueue, getQueue } from "./queue";

dotenv.config();

if (!process.env.TIKTOK_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supergeheim123";

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// ────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────
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

// ────────────────────────────────────────────────
// GLOBAL STATE
// ────────────────────────────────────────────────
const LOG_MAX = 500;
const logBuffer: LogEntry[] = [];
let currentGameId: number | null = null;

// ────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────
export function getCurrentGameId(): number | null {
  return currentGameId;
}

export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

export function emitLog(
  log: Partial<LogEntry> & { type?: string; message?: string }
): void {
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

// ────────────────────────────────────────────────
// STATS & LEADERBOARD
// ────────────────────────────────────────────────
export async function broadcastStats({ allowAutoCreate = true } = {}): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at   TIMESTAMPTZ
      )
    `);

    // Alleen nieuwe game starten als dat expliciet mag
    if (!currentGameId && allowAutoCreate) {
      const last = await pool.query(
        `SELECT id FROM games WHERE status = 'running' ORDER BY id DESC LIMIT 1`
      );
      if (last.rows[0]) {
        currentGameId = Number(last.rows[0].id);
        console.log(`[STATS] Herstelde laatste game-id: #${currentGameId}`);
      } else {
        const init = await pool.query(
          `INSERT INTO games (status) VALUES ('running') RETURNING id`
        );
        currentGameId = Number(init.rows[0].id);
        console.log(`[STATS] Eerste game gestart (#${currentGameId})`);
      }
    }

    // Geen actief spel → push leeg state
    if (!currentGameId) {
      io.emit("gameSession", { active: false, gameId: null });
      return;
    }

    // Stats ophalen
    const statsRes = await pool.query(
      `
      SELECT
        COUNT(DISTINCT CASE WHEN receiver_role IN ('speler','cohost') THEN receiver_id END) AS total_players,
        COALESCE(SUM(CASE WHEN receiver_role IN ('speler','cohost') THEN diamonds ELSE 0 END), 0) AS total_player_diamonds,
        COALESCE(SUM(CASE WHEN receiver_role = 'host' THEN diamonds ELSE 0 END), 0) AS total_host_diamonds
      FROM gifts
      WHERE game_id = $1
      `,
      [currentGameId]
    );

    const s = statsRes.rows[0] || {};
    const stats: StreamStats = {
      totalPlayers: Number(s.total_players || 0),
      totalPlayerDiamonds: Number(s.total_player_diamonds || 0),
      totalHostDiamonds: Number(s.total_host_diamonds || 0),
    };

    io.emit("streamStats", stats);
  } catch (err: any) {
    console.error("broadcastStats error:", err?.message || err);
  }
}

// ────────────────────────────────────────────────
// GAME SESSION HANDLERS
// ────────────────────────────────────────────────
async function startNewGame(): Promise<{ id: number; startedAt: string }> {
  const res = await pool.query(
    `INSERT INTO games (status) VALUES ('running') RETURNING id, started_at`
  );
  const row = res.rows[0];
  currentGameId = Number(row.id);
  const startedAt = row.started_at?.toISOString?.() ?? String(row.started_at);

  emitLog({ type: "system", message: `Nieuw spel gestart (Game #${currentGameId})` });

  const session: GameSessionState = { active: true, gameId: currentGameId, startedAt };
  io.emit("gameSession", session);

  await broadcastStats();
  return { id: currentGameId, startedAt };
}

async function stopCurrentGame(): Promise<void> {
  if (!currentGameId) return;
  const gameId = currentGameId;

  await pool.query(
    `UPDATE games SET status = 'ended', ended_at = NOW() WHERE id = $1`,
    [gameId]
  );

  emitLog({ type: "system", message: `Spel beëindigd (Game #${gameId})` });
  io.emit("gameSession", { active: false, gameId });

  currentGameId = null;
  await broadcastStats({ allowAutoCreate: false });

  console.log(`[GAME] Game #${gameId} beëindigd en currentGameId op null gezet`);
}

// ────────────────────────────────────────────────
// SOCKET CONNECTION (ADMIN)
// ────────────────────────────────────────────────
interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: any, next) => {
  const token = socket.handshake.auth?.token;
  if (token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  return next(new Error("Authentication error"));
});

function cleanUsername(username: string): string {
  return username.replace(/^@+/, "");
}

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN DASHBOARD VERBONDEN:", socket.id);
  console.log(`🚀 Undercover BattleBox Engine v${BATTLEBOX_VERSION} gestart`);

  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("initialLogs", logBuffer);
  socket.emit("gameSession", { active: currentGameId !== null, gameId: currentGameId } as GameSessionState);
  socket.emit("settings", getArenaSettings());
  await broadcastStats({ allowAutoCreate: false });

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  const handleAdminAction = async (action: string, data: any, ack: Function) => {
    try {
      if (action === "startGame") {
        if (currentGameId) return ack({ success: false, message: `Er draait al een spel (Game #${currentGameId})` });
        await startNewGame();
        return ack({ success: true, message: "Spel gestart" });
      }
      if (action === "stopGame") {
        if (!currentGameId) return ack({ success: false, message: "Geen actief spel om te stoppen" });
        await stopCurrentGame();
        return ack({ success: true, message: "Spel beëindigd" });
      }

      if (action === "startRound") {
        const type = (data?.type || "quarter") as "quarter" | "semi" | "finale";
        const ok = startRound(type);
        if (!ok) return ack({ success: false, message: "Kon ronde niet starten (al actief/grace of te weinig spelers)" });
        return ack({ success: true, message: `Ronde gestart (${type})` });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true, message: "Ronde beëindigd" });
      }

      if (action === "updateSettings") {
        const patch = {
          roundDurationPre: Number(data?.roundDurationPre),
          roundDurationFinal: Number(data?.roundDurationFinal),
          graceSeconds: Number(data?.graceSeconds),
        };
        await updateArenaSettings(patch);
        io.emit("settings", getArenaSettings());
        return ack({ success: true, message: "Instellingen opgeslagen" });
      }

      // Gebruikersacties
      if (!data?.username) return ack({ success: false, message: "username vereist" });
      const rawInput = String(data.username).trim();
      const normalized = rawInput.replace(/^@+/, "");
      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users
         WHERE username ILIKE $1 OR username ILIKE $2
         LIMIT 1`,
        [rawInput, `@${normalized}`]
      );
      if (!userRes.rows[0]) return ack({ success: false, message: `Gebruiker ${rawInput} niet gevonden` });

      const { tiktok_id, display_name, username } = userRes.rows[0];
      const tid = tiktok_id.toString();
      const unameClean = cleanUsername(username);

      switch (action) {
        case "addToArena":
          arenaJoin(tid, display_name, username, "admin");
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [tid]);
          await emitQueue();
          emitArena();
          emitLog({ type: "join", message: `${display_name} (@${unameClean}) → arena` });
          break;
        case "addToQueue":
          await addToQueue(tid, username);
          await emitQueue();
          emitLog({ type: "join", message: `${display_name} (@${unameClean}) → wachtrij` });
          break;
        case "eliminate":
          arenaLeave(tid);
          emitArena();
          emitLog({ type: "elim", message: `${display_name} (@${unameClean}) geëlimineerd` });
          break;
        case "removeFromQueue":
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [tid]);
          await emitQueue();
          emitLog({ type: "elim", message: `${display_name} (@${unameClean}) verwijderd uit wachtrij` });
          break;
      }

      ack({ success: true, message: "Actie uitgevoerd" });
    } catch (err: any) {
      console.error("Admin action error:", err);
      ack({ success: false, message: err.message || "Server error" });
    }
  };

  // socket routes
  socket.on("admin:startGame", (d, ack) => handleAdminAction("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handleAdminAction("stopGame", d, ack));
  socket.on("admin:startRound", (d, ack) => handleAdminAction("startRound", d, ack));
  socket.on("admin:endRound", (d, ack) => handleAdminAction("endRound", d, ack));
  socket.on("admin:updateSettings", (d, ack) => handleAdminAction("updateSettings", d, ack));
  socket.on("admin:addToArena", (d, ack) => handleAdminAction("addToArena", d, ack));
  socket.on("admin:addToQueue", (d, ack) => handleAdminAction("addToQueue", d, ack));
  socket.on("admin:eliminate", (d, ack) => handleAdminAction("eliminate", d, ack));
  socket.on("admin:removeFromQueue", (d, ack) => handleAdminAction("removeFromQueue", d, ack));
});

// ────────────────────────────────────────────────
// STARTUP
// ────────────────────────────────────────────────
initDB().then(async () => {
  server.listen(4000, () => console.log("BATTLEBOX LIVE → http://localhost:4000"));

  initGame();

  try {
    const gameRes = await pool.query(
      `SELECT id FROM games WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`
    );
    if (gameRes.rows[0]) {
      currentGameId = Number(gameRes.rows[0].id);
      console.log(`[GAME] Hervat lopend spel: Game #${currentGameId}`);
    }
  } catch (err: any) {
    console.warn("[GAME] Kon games-tabel niet lezen:", err?.message || err);
  }

  await broadcastStats({ allowAutoCreate: false });

  const { conn: tikTokConn } = await startConnection(process.env.TIKTOK_USERNAME!, () => {});
  initGiftEngine(tikTokConn);
});
