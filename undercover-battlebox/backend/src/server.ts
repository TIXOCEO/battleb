// src/server.ts — Undercover BattleBox Engine — v2.1 TWIST-READY (BUILD SAFE)
// Nu met:
//  - Chat Engine (!join, !leave, !boost)
//  - Boost-engine integratie (chat-only)
//  - Fan-only join
//  - Arena 2.0 logica (danger / elimination / forceEliminations)
//  - Ranking updates
//  - Host + reconnect flow
//  - Admin promote/demote in wachtrij
//  - Twist-engine integratie (!use ...)
//  - Admin-twist-engine integratie

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
import { initChatEngine } from "./engines/6-chat-engine";
import { applyBoost } from "./engines/7-boost-engine";

// Twist imports
import { parseUseCommand } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { getOrUpdateUser } from "./engines/2-user-engine";

dotenv.config();

// ─────────────────────────────────────────────
// ADMIN TOKEN
// ─────────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ─────────────────────────────────────────────
// EXPRESS + HTTP
// ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ─────────────────────────────────────────────
// SOCKET.IO INITIALISATIE
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentGameId: number | null = null;

// Backwards compatibility (old gift-engine)
export function getCurrentGameId() {
  return currentGameId;
}

// Nieuwere engines kunnen dit gebruiken:
(io as any).currentGameId = null;

// LOG BUFFER
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

// ─────────────────────────────────────────────
// QUEUE PUSHER
// ─────────────────────────────────────────────
export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
}

// ─────────────────────────────────────────────
// STREAM STATS
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GAME SESSION LOADING
// ─────────────────────────────────────────────
async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    (io as any).currentGameId = currentGameId;
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
  } else {
    currentGameId = null;
    (io as any).currentGameId = null;
    console.log("[GAME] Geen actieve game gevonden");
  }
}

async function startNewGame() {
  const res = await pool.query(
    `INSERT INTO games (status) VALUES ('running') RETURNING id, started_at`
  );

  currentGameId = Number(res.rows[0].id);
  (io as any).currentGameId = currentGameId;

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
  (io as any).currentGameId = null;

  await broadcastStats();
}

// ─────────────────────────────────────────────
// ADMIN AUTH
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// TIKTOK CONNECTION MANAGEMENT
// ─────────────────────────────────────────────
let tiktokConn: any = null;

async function restartTikTokConnection() {
  try {
    if (tiktokConn) {
      try {
        await stopConnection(tiktokConn);
      } catch {}
      tiktokConn = null;
    }

    const host = await getSetting("host_username");
    if (!host) {
      console.log("⚠ Geen host ingesteld — wacht op nieuwe host");
      return;
    }

    console.log("🔄 TikTok opnieuw verbinden →", host);

    const { conn } = await startConnection(host, () => {});
    tiktokConn = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    if (conn) {
      conn.on("chat", async (msg: any) => {
        try {
          const senderId =
            msg.user?.userId ||
            msg.sender?.userId ||
            msg.userId ||
            msg.uid;

          if (!senderId) return;

          const rawText = msg.comment || msg.text || msg.content || "";
          const text = rawText.toString().trim();

          if (!text.toLowerCase().startsWith("!use ")) return;

          const sender = await getOrUpdateUser(
            String(senderId),
            msg.user?.nickname || msg.sender?.nickname,
            msg.user?.uniqueId || msg.sender?.uniqueId
          );

          await parseUseCommand(sender.id, sender.display_name, text);
        } catch (err: any) {
          console.error("Twist chat handler error:", err?.message || err);
        }
      });
    }

  } catch (err) {
    console.error("❌ TikTok reconnect error:", err);
  }
}

// ─────────────────────────────────────────────
// ADMIN SOCKET EVENTS
// ─────────────────────────────────────────────
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);

  // Push snapshots
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("settings", getArenaSettings());
  socket.emit("host", await getSetting("host_username"));

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  initAdminTwistEngine(socket);

  // GENERIEKE HANDLER
  const handle = async (action: string, data: any, ack: Function) => {
    try {
      // Instellingen lezen
      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: (await getSetting("host_username")) || "",
          gameActive: currentGameId !== null,
        });
      }

      // Host instellen
      if (action === "setHost") {
        if (currentGameId) {
          return ack({
            success: false,
            message: "Host kan niet worden gewijzigd tijdens actief spel",
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

      // GAME CONTROL
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

      // Ronde beheer
      if (action === "startRound") {
        const ok = startRound(data?.type || "quarter");
        return ack(ok ? { success: true } : { success: false });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      // Instellingen bijwerken
      if (action === "updateSettings") {
        await updateArenaSettings({
          roundDurationPre: Number(data?.roundDurationPre),
          roundDurationFinal: Number(data?.roundDurationFinal),
          graceSeconds: Number(data?.graceSeconds),
        });

        io.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

      // User acties
      if (!data?.username)
        return ack({
          success: false,
          message: "username verplicht",
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

      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username);
          await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [
            tiktok_id,
          ]);
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
          await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [
            tiktok_id,
          ]);
          await emitQueue();
          emitLog({
            type: "elim",
            message: `${display_name} uit queue verwijderd`,
          });
          break;

        case "promoteUser":
          await applyBoost(String(tiktok_id), 1, display_name);
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} handmatig gepromoveerd (+1)`,
          });
          break;

        case "demoteUser":
          await pool.query(
            `UPDATE queue SET boost_spots = GREATEST(boost_spots - 1, 0)
             WHERE user_tiktok_id=$1`,
            [tiktok_id]
          );
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} handmatig gedemoveerd (-1)`,
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

  socket.on("admin:promoteUser", (d, ack) =>
    handle("promoteUser", d, ack)
  );

  socket.on("admin:demoteUser", (d, ack) =>
    handle("demoteUser", d, ack)
  );
});

// ───────────────────────────────────────────
// EXPORTS
// ───────────────────────────────────────────
export { emitArena }; // ← essentieel voor twist-engine

// ─────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();

  await initDynamicHost();

  const host = await getSetting("host_username");

  if (host) {
    console.log("Connecting TikTok with saved host:", host);
    const { conn } = await startConnection(host, () => {});
    tiktokConn = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    if (conn) {
      conn.on("chat", async (msg: any) => {
        try {
          const senderId =
            msg.user?.userId ||
            msg.sender?.userId ||
            msg.userId ||
            msg.uid;

          if (!senderId) return;

          const rawText = msg.comment || msg.text || msg.content || "";
          const text = rawText.toString().trim();

          if (!text.toLowerCase().startsWith("!use ")) return;

          const sender = await getOrUpdateUser(
            String(senderId),
            msg.user?.nickname || msg.sender?.nickname,
            msg.user?.uniqueId || msg.sender?.uniqueId
          );

          await parseUseCommand(sender.id, sender.display_name, text);
        } catch (err: any) {
          console.error("Twist chat handler error:", err?.message || err);
        }
      });
    }
  } else {
    console.log("⚠ Geen host ingesteld — wacht op admin:setHost");
  }
});
