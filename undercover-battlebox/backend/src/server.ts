// ============================================================================
// server.ts — BATTLEBOX BACKEND v7.3 REALTIME PATCH (CORRECTED FINAL)
// Gifts-Driven Engine + Round Flags (is_round_gift / round_active)
// Correct Leaderboards + Host Diamonds + Username Autofill
// Realtime Arena Diamond Updates (minimal required changes)
// Idle gifts → NIET tellen (speler), WEL tellen (host)
// Gifter leaderboard volgt beide regels correct
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db";

// Engines
import { startConnection, stopConnection } from "./engines/1-connection";
import { initGiftEngine } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";

import {
  arenaJoin,
  arenaLeave,
  arenaClear,
  getArena as getArenaRaw,
  emitArena as emitArenaRaw,
  getArenaSettings,
  startRound,
  endRound,
  loadArenaSettingsFromDB,
  updateArenaSettings
} from "./engines/5-game-engine";

import { getQueue } from "./queue";
import { giveTwistAdmin, useTwistAdmin } from "./engines/9-admin-twist-engine";

// ============================================================================
// CONFIG
// ============================================================================
dotenv.config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";
const PORT = Number(process.env.PORT || 4000);

// ============================================================================
// STREAM STATE
// ============================================================================
let streamLive = false;

export function setLiveState(v: boolean) {
  streamLive = v;
  io.emit("connectState", { connected: v });
}

export function isStreamLive() {
  return streamLive;
}

// ============================================================================
// LOGGING BUFFER
// ============================================================================
type LogEntry = {
  id: string;
  timestamp: string;
  type: string;
  message: string;
};

const logBuffer: LogEntry[] = [];
const LOG_MAX = 500;

export function emitLog(entry: Partial<LogEntry>) {
  const log: LogEntry = {
    id: entry.id ?? `${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: entry.type ?? "system",
    message: entry.message ?? ""
  };

  logBuffer.unshift(log);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();

  io.emit("log", log);
}

// ============================================================================
// EXPRESS + SOCKET.IO INIT
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

export const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io"
});

// ============================================================================
// AUTH
// ============================================================================
interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: AdminSocket, next) => {
  const token = socket.handshake.auth?.token;
  if (token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  return next(new Error("Unauthorized"));
});

// ============================================================================
// HOST STATE
// ============================================================================
let HARD_HOST_USERNAME = "";
let HARD_HOST_ID: string | null = null;

async function loadActiveHostProfile() {
  const r = await pool.query(`
    SELECT username, tiktok_id
    FROM hosts
    WHERE active=TRUE
    LIMIT 1
  `);

  if (!r.rows.length) {
    HARD_HOST_USERNAME = "";
    HARD_HOST_ID = null;
    return;
  }

  HARD_HOST_USERNAME = r.rows[0].username;
  HARD_HOST_ID = String(r.rows[0].tiktok_id);
}

export function getActiveHost() {
  if (!HARD_HOST_ID) return null;
  return {
    id: HARD_HOST_ID,
    username: HARD_HOST_USERNAME,
    display_name: HARD_HOST_USERNAME
  };
}

// ============================================================================
// GAME STATE
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

// ============================================================================
// ARENA WRAPPERS
// ============================================================================
export async function emitArena() {
  await emitArenaRaw();
}

export function getArena() {
  return getArenaRaw();
}

// ============================================================================
// LEADERBOARDS — FIXED RULES
// ============================================================================

export async function broadcastPlayerLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardPlayers", []);
    io.emit("leaderboardPlayersSummary", 0);
    return;
  }

  const hostId = HARD_HOST_ID ? BigInt(HARD_HOST_ID) : null;

  const q = await pool.query(
    `
    SELECT
      receiver_id AS tiktok_id,
      receiver_username AS username,
      receiver_display_name AS display_name,
      SUM(diamonds) AS total_score
    FROM gifts
    WHERE game_id=$1
      AND is_round_gift = TRUE
      AND COALESCE(receiver_role,'speler')='speler'
      AND receiver_id IS NOT NULL
      AND ( $2::bigint IS NULL OR receiver_id <> $2 )
    GROUP BY receiver_id, receiver_username, receiver_display_name
    ORDER BY total_score DESC
    LIMIT 200
    `,
    [currentGameId, hostId]
  );

  // 🔥 FIX: conversie naar numbers
  q.rows = q.rows.map(r => ({
    ...r,
    total_score: Number(r.total_score || 0)
  }));

  const summary = q.rows.reduce(
    (acc, r) => acc + r.total_score,
    0
  );

  io.emit("leaderboardPlayers", q.rows);
  io.emit("leaderboardPlayersSummary", summary);
}

export async function broadcastGifterLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardGifters", []);
    io.emit("leaderboardGiftersSummary", 0);
    return;
  }

  const r = await pool.query(
    `
    SELECT 
      giver_id AS user_id,
      giver_username AS username,
      giver_display_name AS display_name,
      SUM(diamonds) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
      AND (
        round_active = TRUE
        OR is_host_gift = TRUE
      )
    GROUP BY giver_id, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
    LIMIT 200
    `,
    [currentGameId]
  );

  // 🔥 FIX: altijd numbers
  r.rows = r.rows.map(x => ({
    ...x,
    total_diamonds: Number(x.total_diamonds || 0)
  }));

  const sum = r.rows.reduce(
    (a, b) => a + b.total_diamonds,
    0
  );

  io.emit("leaderboardGifters", r.rows);
  io.emit("leaderboardGiftersSummary", sum);
}

// HOST DIAMONDS
export async function broadcastHostDiamonds() {
  if (!currentGameId || !HARD_HOST_ID) {
    io.emit("hostDiamonds", { username: "", total: 0 });
    return;
  }

  const q = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds),0) AS total
    FROM gifts
    WHERE game_id=$1
      AND is_host_gift=TRUE
    `,
    [currentGameId]
  );

  io.emit("hostDiamonds", {
    username: HARD_HOST_USERNAME,
    total: Number(q.rows[0].total || 0)
  });
}
