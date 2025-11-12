// src/server.ts — BATTLEBOX 5-ENGINE – ADMIN DASHBOARD LIVE – QUEUE, LOGS, GAMES & STATS

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
} from "./engines/5-game-engine";
import { addToQueue, getQueue } from "./queue";

dotenv.config();

if (!process.env.TIKTOK_USERNAME) {
  console.error("FATAL: TIKTOK_USERNAME ontbreekt in .env!");
  process.exit(1);
}

const ADMIN_TOKEN = "supergeheim123";

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// ── TYPES ─────────────────────────────────────────────────────────

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

const LOG_MAX = 500;
const logBuffer: LogEntry[] = [];

// Huidige game ID in geheugen (1 spel = 1 volledige BattleBox run)
let currentGameId: number | null = null;

// ── HELPERS VOOR GAME-ID & STATS (voor gift-engine) ────────────
export function getCurrentGameId(): number | null {
  return currentGameId;
}

// ── API ENDPOINTS ──────────────────────────────────────────────
app.get("/queue", async (_req, res) => {
  const entries = await getQueue();
  res.json({ open: true, entries });
});

app.get("/arena", async (_req, res) => res.json(getArena()));
app.get("/logs", (_req, res) => res.json({ logs: logBuffer }));

// ── ADMIN AUTH MIDDLEWARE ──────────────────────────────────────
const requireAdmin = (req: any, res: any, next: any) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_TOKEN}`) return next();
  res.status(401).json({ success: false, message: "Unauthorized" });
};

// ── SOCKET AUTH ────────────────────────────────────────────────
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

// ── EMIT QUEUE ─────────────────────────────────────────────────
export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// ── EMIT LOG (BUFFER + BROADCAST) ─────────────────────────────
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

// ── STATS & LEADERBOARD BEREKENEN EN EMITTEN ───────────────────
export async function broadcastStats(): Promise<void> {
  try {
    if (!currentGameId) {
      const emptyStats: StreamStats = {
        totalPlayers: 0,
        totalPlayerDiamonds: 0,
        totalHostDiamonds: 0,
      };
      io.emit("streamStats", emptyStats);
      io.emit("streamLeaderboard", [] as LeaderboardEntry[]);
      return;
    }

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

    const lbRes = await pool.query(
      `
      SELECT
        receiver_id,
        receiver_username,
        receiver_display_name,
        COALESCE(SUM(diamonds), 0) AS total_diamonds
      FROM gifts
      WHERE game_id = $1
        AND receiver_role IN ('speler','cohost')
      GROUP BY receiver_id, receiver_username, receiver_display_name
      ORDER BY total_diamonds DESC
      LIMIT 50
      `,
      [currentGameId]
    );

    const leaderboard: LeaderboardEntry[] = lbRes.rows.map((row: any) => ({
      user_id: row.receiver_id ? String(row.receiver_id) : "",
      display_name: row.receiver_display_name,
      username: (row.receiver_username || "").replace(/^@+/, ""),
      total_diamonds: Number(row.total_diamonds || 0),
    }));

    io.emit("streamStats", stats);
    io.emit("streamLeaderboard", leaderboard);
  } catch (err: any) {
    console.error("broadcastStats error:", err?.message || err);
  }
}

// ── GAME SESSION HELPERS ───────────────────────────────────────
async function startNewGame(): Promise<{ id: number; startedAt: string }> {
  const res = await pool.query(
    `INSERT INTO games (status) VALUES ('running') RETURNING id, started_at`,
    []
  );
  const row = res.rows[0];
  currentGameId = Number(row.id);
  const startedAt = row.started_at?.toISOString?.() ?? String(row.started_at);

  emitLog({
    type: "system",
    message: `Nieuw spel gestart (Game #${currentGameId})`,
  });

  const session: GameSessionState = {
    active: true,
    gameId: currentGameId,
    startedAt,
  };
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
  currentGameId = null;

  emitLog({
    type: "system",
    message: `Spel beëindigd (Game #${gameId})`,
  });

  const session: GameSessionState = {
    active: false,
    gameId,
  };
  io.emit("gameSession", session);

  await broadcastStats();
}

// ── UTIL ───────────────────────────────────────────────────────
function cleanUsername(username: string): string {
  return username.replace(/^@+/, "");
}

// ── SOCKET CONNECTION ──────────────────────────────────────────
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) {
    console.log("Unauthenticated socket attempt");
    return socket.disconnect();
  }

  console.log("ADMIN DASHBOARD VERBONDEN:", socket.id);
  console.log(`🚀 Undercover BattleBox Engine v${BATTLEBOX_VERSION} gestart`);

  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("initialLogs", logBuffer);

  // Game-session status + stats naar nieuwe admin
  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  } as GameSessionState);
  await broadcastStats();

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  const handleAdminAction = async (
    action: string,
    data: any,
    ack: Function
  ) => {
    try {
      // acties die geen username nodig hebben
      if (action === "startGame") {
        if (currentGameId) {
          return ack({
            success: false,
            message: `Er draait al een spel (Game #${currentGameId})`,
          });
        }
        await startNewGame();
        return ack({ success: true, message: "Spel gestart" });
      }

      if (action === "stopGame") {
        if (!currentGameId) {
          return ack({
            success: false,
            message: "Geen actief spel om te stoppen",
          });
        }
        await stopCurrentGame();
        return ack({ success: true, message: "Spel beëindigd" });
      }

      // vanaf hier hebben we een username nodig
      if (!data?.username)
        return ack({ success: false, message: "username vereist" });

      const rawInput = String(data.username).trim();
      if (!rawInput)
        return ack({ success: false, message: "Lege username" });

      const normalized = rawInput.replace(/^@+/, "");

      const userRes = await pool.query(
        `
        SELECT tiktok_id, display_name, username
        FROM users
        WHERE username ILIKE $1 OR username ILIKE $2
        LIMIT 1
        `,
        [rawInput, `@${normalized}`]
      );
      if (!userRes.rows[0])
        return ack({
          success: false,
          message: `Gebruiker ${rawInput} niet gevonden`,
        });

      const { tiktok_id, display_name, username } = userRes.rows[0];
      const tid = tiktok_id.toString();
      const unameClean = cleanUsername(username);

      switch (action) {
        case "addToArena":
          arenaJoin(tid, display_name, username, "admin");
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [
            tid,
          ]);
          await emitQueue();
          emitArena();
          emitLog({
            type: "join",
            message: `${display_name} (@${unameClean}) → arena`,
          });
          break;

        case "addToQueue":
          await addToQueue(tid, username);
          await emitQueue();
          emitLog({
            type: "join",
            message: `${display_name} (@${unameClean}) → wachtrij`,
          });
          break;

        case "eliminate":
          arenaLeave(tid);
          emitArena();
          emitLog({
            type: "elim",
            message: `${display_name} (@${unameClean}) geëlimineerd`,
          });
          break;

        case "removeFromQueue":
          await pool.query("DELETE FROM queue WHERE user_tiktok_id = $1", [
            tid,
          ]);
          await emitQueue();
          emitLog({
            type: "elim",
            message: `${display_name} (@${unameClean}) verwijderd uit wachtrij`,
          });
          break;

        default:
          return ack({
            success: false,
            message: "Onbekende actie",
          });
      }

      ack({ success: true, message: "Actie uitgevoerd" });
    } catch (err: any) {
      console.error("Admin action error:", err);
      ack({ success: false, message: err.message || "Server error" });
    }
  };

  socket.on("admin:startGame", (d, ack) =>
    handleAdminAction("startGame", d, ack)
  );
  socket.on("admin:stopGame", (d, ack) =>
    handleAdminAction("stopGame", d, ack)
  );
  socket.on("admin:addToArena", (d, ack) =>
    handleAdminAction("addToArena", d, ack)
  );
  socket.on("admin:addToQueue", (d, ack) =>
    handleAdminAction("addToQueue", d, ack)
  );
  socket.on("admin:eliminate", (d, ack) =>
    handleAdminAction("eliminate", d, ack)
  );
  socket.on("admin:removeFromQueue", (d, ack) =>
    handleAdminAction("removeFromQueue", d, ack)
  );
});

// ── ADMIN REST ENDPOINT (placeholder) ─────────────────────────
app.post("/api/admin/:action", requireAdmin, async (_req, res) =>
  res.json({ success: true, message: "REST endpoint klaar" })
);

// ── GLOBALS & STARTUP ─────────────────────────────────────────
const ADMIN_ID = process.env.ADMIN_TIKTOK_ID?.trim();
let conn: any = null;

initDB().then(async () => {
  server.listen(4000, () =>
    console.log("BATTLEBOX LIVE → http://localhost:4000")
  );

  initGame();

  // Probeer lopend spel te hervatten bij restart
  try {
    const gameRes = await pool.query(
      `
      SELECT id, started_at
      FROM games
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
      `
    );
    if (gameRes.rows[0]) {
      currentGameId = Number(gameRes.rows[0].id);
      console.log(`[GAME] Hervat lopend spel: Game #${currentGameId}`);
    }
  } catch (err: any) {
    console.warn(
      "[GAME] Kon games-tabel niet lezen (misschien nog niet aangemaakt):",
      err?.message || err
    );
  }

  await broadcastStats();

  const { conn: tikTokConn } = await startConnection(
    process.env.TIKTOK_USERNAME!,
    () => {}
  );
  conn = tikTokConn;
  initGiftEngine(conn);

  // (Eventueel kun je hier later weer chat/like/follow/share handlers hangen)
});
