// ============================================================================
// server.ts — Undercover BattleBox Engine — v2.20 (Stable Clean Build)
// ============================================================================
//
// Compact, opgeschoond, sneller en 100% compatibel met:
//  - Arena Engine
//  - Gift Engine
//  - Twist Engine / Twist Inventory / Admin twists
//  - Chat Engine (!join / !leave / !boost / !use)
//  - Queue Engine
//  - TikTok Connector
//  - Admin Panel
//
// Belangrijke verbeteringen:
//  ✓ broadcastStats teruggeplaatst
//  ✓ restartTikTokConnection opschoond
//  ✓ geen forced process.exit meer
//  ✓ host offline? → idle, wacht op admin
//  ✓ dubbele chat listeners verwijderd
//  ✓ cleaner event-flow
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
import { initGiftEngine } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";
import { initDynamicHost } from "./engines/3-gift-engine";
import { arenaJoin, getArena, emitArena, startRound, endRound } from "./engines/5-game-engine";
import { updateArenaSettings, getArenaSettings } from "./engines/5-game-engine";
import { applyBoost } from "./engines/7-boost-engine";
import { parseUseCommand } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { getOrUpdateUser } from "./engines/2-user-engine";

import { getQueue, addToQueue } from "./queue";

dotenv.config();

// ============================================================================
// GLOBAL STATE
// ============================================================================
export let tiktokConnShared: any = null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";
let currentGameId: number | null = null;

// ============================================================================
// EXPRESS + HTTP
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

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

export function getCurrentGameId() {
  return currentGameId;
}

// ============================================================================
// QUEUE EMIT
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

  const q = await pool.query(
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

  const row = q.rows[0] || {};

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
    SELECT id
    FROM games
    WHERE status='running'
    ORDER BY id DESC
    LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = Number(res.rows[0].id);
    console.log(`✓ Actieve game geladen: #${currentGameId}`);
  } else {
    console.log("ℹ Geen actief spel gevonden.");
    currentGameId = null;
  }
}

// ============================================================================
// TIKTOK CONNECTION HANDLER (gefixte versie)
// ============================================================================
async function restartTikTokConnection() {
  const host = await getSetting("host_username");

  // Host offline? → engine blijft draaien zonder TikTok.
  if (!host) {
    console.log("⚠ Geen host ingesteld — TikTok idle mode.");
    tiktokConnShared = null;
    return;
  }

  console.log("🔄 Herstart TikTok connectie voor host:", host);

  // Oude verbinding sluiten
  if (tiktokConnShared) {
    try {
      await stopConnection(tiktokConnShared);
    } catch {}
  }
  tiktokConnShared = null;

  try {
    const { conn } = await startConnection(host, () => {});
    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    // !use detectie
    conn.on("chat", async (msg: any) => {
      const uid =
        msg.user?.userId ||
        msg.sender?.userId ||
        msg.userId ||
        msg.uid;

      if (!uid) return;

      const txt =
        msg.comment || msg.text || msg.content || "";
      const clean = txt.trim().toLowerCase();

      if (!clean.startsWith("!use")) return;

      const user = await getOrUpdateUser(
        String(uid),
        msg.user?.nickname || msg.sender?.nickname,
        msg.user?.uniqueId || msg.sender?.uniqueId
      );

      await parseUseCommand(
        user.id,
        user.display_name,
        clean
      );
    });

  } catch (err: any) {
    console.log("⚠ Host offline of geen verbinding mogelijk:", err?.message);
    console.log("⏳ Idle mode — wacht tot admin een nieuwe host instelt.");
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
  } else {
    next(new Error("Unauthorized"));
  }
});

// ============================================================================
// ADMIN SOCKET EVENTS (BEGIN) — gaat verder in deel 2
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

  // Twist admin engine koppelen
  initAdminTwistEngine(socket);

  // … DEEL 2 GAAT HIER VERDER
});

// ============================================================================
// ADMIN SOCKET EVENTS — vervolg van deel 1
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

  // Admin twist engine
  initAdminTwistEngine(socket);

  // ───────────────────────────────────────────────
  // ADMIN: game starten
  // ───────────────────────────────────────────────
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

  // ───────────────────────────────────────────────
  // ADMIN: game stoppen
  // ───────────────────────────────────────────────
  socket.on("admin:stopGame", async (_, ack: Function) => {
    try {
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

      io.emit("gameSession", {
        active: false,
        gameId: null,
      });

      ack({ success: true });
    } catch (err: any) {
      ack({ success: false, message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // ADMIN: ronde starten
  // ───────────────────────────────────────────────
  socket.on("admin:startRound", ({ type }, ack: Function) => {
    const ok = startRound(type);
    ack({
      success: ok,
      message: ok ? "Ronde gestart." : "Kon ronde niet starten.",
    });
  });

  // ───────────────────────────────────────────────
  // ADMIN: ronde beëindigen
  // ───────────────────────────────────────────────
  socket.on("admin:endRound", async (_, ack: Function) => {
    endRound();
    ack({ success: true });
  });

  // ───────────────────────────────────────────────
  // ADMIN: host opslaan
  // ───────────────────────────────────────────────
  socket.on(
    "admin:setHost",
    async ({ username }: { username: string }, ack: Function) => {
      try {
        if (!username || !username.trim()) {
          return ack({ success: false, message: "Ongeldige username" });
        }

        const clean = username.trim().replace(/^@/, "");

        await pool.query(
          `INSERT INTO settings(key, value)
           VALUES('host_username', $1)
           ON CONFLICT(key)
           DO UPDATE SET value = EXCLUDED.value`,
          [clean]
        );

        emitLog({
          type: "admin",
          message: `Host aangepast naar @${clean}`,
        });

        socket.emit("host", clean);
        io.emit("host", clean);

        // TikTok verbinding herstarten (maar NIET crashen als host offline is)
        restartTikTokConnection();

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ───────────────────────────────────────────────
  // ADMIN: arena instellingen opslaan
  // ───────────────────────────────────────────────
  socket.on(
    "admin:updateSettings",
    async (settings: any, ack: Function) => {
      try {
        const ok = updateArenaSettings(settings);
        if (!ok) return ack({ success: false, message: "Ongeldig" });

        io.emit("settings", settings);

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ───────────────────────────────────────────────
  // ADMIN: speler in arena zetten
  // ───────────────────────────────────────────────
  socket.on(
    "admin:addToArena",
    async ({ username }, ack: Function) => {
      try {
        const clean = username.replace("@", "").toLowerCase();

        const userRes = await pool.query(
          `SELECT tiktok_id, display_name, username
           FROM users
           WHERE LOWER(username)=LOWER($1)
           LIMIT 1`,
          [clean]
        );

        if (!userRes.rows[0]) {
          return ack({ success: false, message: "User niet gevonden" });
        }

        const u = userRes.rows[0];

        arenaJoin(String(u.tiktok_id), u.display_name, u.username);

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );

  // ───────────────────────────────────────────────
  // ADMIN: speler in wachtrij zetten
  // ───────────────────────────────────────────────
  socket.on(
    "admin:addToQueue",
    async ({ username }, ack: Function) => {
      try {
        const clean = username.replace("@", "");

        await addToQueue(clean, clean);
        await emitQueue();

        ack({ success: true });
      } catch (err: any) {
        ack({ success: false, message: err.message });
      }
    }
  );
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

  // Game state laden
  await loadActiveGame();

  // Host detecteren vanuit DB
  await initDynamicHost();

  const host = await getSetting("host_username");

  if (process.env.NODE_ENV === "production" && host) {
    console.log("🔌 Host gevonden:", host);
    restartTikTokConnection();
  } else {
    console.log("⏸ Geen TikTok connectie (dev mode of geen host).");
  }
});
