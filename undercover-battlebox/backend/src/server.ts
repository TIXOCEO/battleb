// src/server.ts — Undercover BattleBox Engine — v1.5 stable-host-sync

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting, setSetting } from "./db";
import { initDB } from "./db";

import { startConnection, stopConnection } from "./engines/1-connection";
import {
  initGiftEngine,
  initDynamicHost,
  refreshHostUsername,
} from "./engines/3-gift-engine";

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

// ADMIN TOKEN
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io",
});

// TYPES
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

// STATE
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

export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// STREAM STATS
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

  io.emit("streamStats", stats);
}

// GAME SESSION LOADING
async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`[GAME] Actieve game geladen #${currentGameId}`);
  } else {
    currentGameId = null;
    console.log("[GAME] Geen actieve game beschikbaar");
  }
}

async function startNewGame() {
  const res = await pool.query(
    `
      INSERT INTO games (status)
      VALUES ('running')
      RETURNING id, started_at
    `
  );

  currentGameId = Number(res.rows[0].id);

  emitLog({
    type: "system",
    message: `Nieuw spel gestart (#${currentGameId})`,
  });

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

  const gameId = currentGameId;

  await pool.query(
    `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1`,
    [gameId]
  );

  emitLog({
    type: "system",
    message: `Spel beëindigd (#${gameId})`,
  });

  io.emit("gameSession", {
    active: false,
    gameId,
    endedAt: new Date().toISOString(),
  });

  currentGameId = null;

  await broadcastStats();
}

// ADMIN SOCKET
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

// START TIKTOK CONNECTION HOLDER
let tiktokConn: any = null;

// RESTART TIKTOK CONNECTION (used after host change)
async function restartTikTokConnection() {
  try {
    if (tiktokConn) {
      try {
        await stopConnection(tiktokConn);
      } catch {
        // ignore errors on closing old connection
      }
      tiktokConn = null;
    }

    const host = await getSetting("host_username");
    if (!host) {
      console.log("⚠ Geen host ingesteld — wacht op host change");
      return;
    }

    console.log("🔄 TIKTOK opnieuw verbinden met host:", host);

    const { conn } = await startConnection(host, () => {});
    tiktokConn = conn;

    initGiftEngine(conn);
  } catch (err) {
    console.error("❌ Fout bij restart TikTok:", err);
  }
}

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);

  // PUSH CURRENT STATE
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  socket.emit("settings", getArenaSettings());
  socket.emit("host", await getSetting("host_username"));

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  // SNAPSHOT ENDPOINT
  socket.on(
    "admin:getInitialSnapshot",
    async (_: any, ack: Function) => {
      try {
        const arena = getArena();
        const queue = { open: true, entries: await getQueue() };
        const logs = logBuffer;

        let statsSnapshot: StreamStats | null = null;

        if (currentGameId) {
          const statsQuery = await pool.query(
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

          const row = statsQuery.rows[0] || {};

          statsSnapshot = {
            totalPlayers: Number(row.total_players || 0),
            totalPlayerDiamonds: Number(
              row.total_player_diamonds || 0
            ),
            totalHostDiamonds: Number(
              row.total_host_diamonds || 0
            ),
          };
        }

        ack({
          arena,
          queue,
          logs,
          stats: statsSnapshot,
          gameSession: {
            active: currentGameId !== null,
            gameId: currentGameId,
          },
          leaderboard: [],
        });
      } catch (err) {
        console.error("admin:getInitialSnapshot error:", err);
        ack(null);
      }
    }
  );

  // MAIN HANDLER
  const handle = async (action: string, data: any, ack: Function) => {
    try {
      // READ SETTINGS
      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: (await getSetting("host_username")) || "",
          gameActive: currentGameId !== null,
        });
      }

      // SET HOST (BLOCK WHEN GAME ACTIVE)
      if (action === "setHost") {
        if (currentGameId) {
          return ack({
            success: false,
            message:
              "Host kan niet worden gewijzigd tijdens een actief spel",
          });
        }

        const name = data?.username?.trim().replace(/^@/, "") || "";
        await setSetting("host_username", name);

        emitLog({
          type: "system",
          message: `Nieuwe host ingesteld: @${name}`,
        });

        await refreshHostUsername();
        io.emit("host", name);

        await restartTikTokConnection();

        return ack({ success: true });
      }

      // GAME START
      if (action === "startGame") {
        if (currentGameId)
          return ack({ success: false, message: "Er draait al een spel" });
        await startNewGame();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId)
          return ack({
            success: false,
            message: "Geen actief spel",
          });

        await stopCurrentGame();
        return ack({ success: true });
      }

      // ROUND CONTROL
      if (action === "startRound") {
        const ok = startRound(data?.type || "quarter");
        return ack(ok ? { success: true } : { success: false });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      // UPDATE TIMER SETTINGS
      if (action === "updateSettings") {
        await updateArenaSettings({
          roundDurationPre: Number(data?.roundDurationPre),
          roundDurationFinal: Number(data?.roundDurationFinal),
          graceSeconds: Number(data?.graceSeconds),
        });

        io.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

      // USER OPS
      if (!data?.username)
        return ack({
          success: false,
          message: "username vereist",
        });

      const raw = data.username.trim().replace(/^@/, "");

      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users
         WHERE username ILIKE $1 OR username ILIKE $2
         LIMIT 1`,
        [raw, `@${raw}`]
      );

      if (!userRes.rows[0])
        return ack({
          success: false,
          message: `Gebruiker ${raw} niet gevonden`,
        });

      const { tiktok_id, display_name, username } = userRes.rows[0];

      // ACTIONS
      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username);
          await pool.query(
            `DELETE FROM queue WHERE user_tiktok_id=$1`,
            [tiktok_id]
          );
          await emitQueue();
          emitArena();
          emitLog({ type: "join", message: `${display_name} → arena` });
          break;

        case "addToQueue":
          await addToQueue(String(tiktok_id), username);
          await emitQueue();
          emitLog({ type: "join", message: `${display_name} → queue` });
          break;

        case "eliminate":
          arenaLeave(String(tiktok_id));
          emitArena();
          emitLog({ type: "elim", message: `${display_name} geëlimineerd` });
          break;

        case "removeFromQueue":
          await pool.query(
            `DELETE FROM queue WHERE user_tiktok_id=$1`,
            [tiktok_id]
          );
          await emitQueue();
          emitLog({
            type: "elim",
            message: `${display_name} uit queue verwijderd`,
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

  // BIND EVENTS
  socket.on("admin:getSettings", (d, ack) => handle("getSettings", d, ack));
  socket.on("admin:setHost", (d, ack) => handle("setHost", d, ack));

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

// STARTUP
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();

  // Dynamic host system
  await initDynamicHost();

  // Start TikTok met host uit DB ipv .env
  const host = await getSetting("host_username");

  if (host) {
    console.log("Connecting TikTok with saved host:", host);
    const { conn } = await startConnection(host, () => {});
    tiktokConn = conn;
    initGiftEngine(conn);
  } else {
    console.log("⚠ Geen host ingesteld — wacht op admin:setHost");
  }
});
