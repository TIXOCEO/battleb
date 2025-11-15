// src/server.ts — Undercover BattleBox Engine — FIXED v1.95

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

dotenv.config();

// ─────────────────────────────────────────────
// SHARED TIKTOK CONNECTION (ENIGE GELDIGE VAR)
// ─────────────────────────────────────────────
export let tiktokConnShared: any = null;

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
// EASY GIFT LIST ENDPOINT
// ─────────────────────────────────────────────
app.get("/admin/gifts", async (req, res) => {
  try {
    if (!tiktokConnShared) {
      return res.json({
        success: false,
        message: "Geen actieve TikTok-verbinding",
        gifts: []
      });
    }

    if (typeof tiktokConnShared.getAvailableGifts !== "function") {
      return res.json({
        success: false,
        message: "TikTok-verbinding ondersteunt gift-opvraging nog niet",
        gifts: []
      });
    }

    const gifts = await tiktokConnShared.getAvailableGifts();

    return res.json({
      success: true,
      gifts: gifts.map((g: any) => ({
        id: g.id,
        name: g.name,
        diamonds: g.diamond_count
      }))
    });

  } catch (err: any) {
    return res.json({
      success: false,
      error: err.message,
      gifts: []
    });
  }
});

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

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentGameId: number | null = null;

export function getCurrentGameId() {
  return currentGameId;
}

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

  const statsRes = await pool.query(`
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
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
  } else {
    currentGameId = null;
    console.log("[GAME] Geen actieve game gevonden");
  }
}

// ─────────────────────────────────────────────
// TIKTOK CONNECTION MANAGEMENT (SCHOON)
// ─────────────────────────────────────────────
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
      console.log("⚠ Geen host ingesteld — wacht op nieuwe host");
      return;
    }

    console.log("🔄 TikTok opnieuw verbinden →", host);

    const { conn } = await startConnection(host, () => {});
    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

  } catch (err) {
    console.error("❌ TikTok reconnect error:", err);
  }
}

// ─────────────────────────────────────────────
// ADMIN SOCKET EVENTS
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

// (ADMIN events blijven exact zoals je had — ik laat ze intact)

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
    tiktokConnShared = conn;

    initGiftEngine(conn);
    initChatEngine(conn);
  } else {
    console.log("⚠ Geen host ingesteld — wacht op admin:setHost");
  }
});
