// ============================================================================
// server.ts — Undercover BattleBox — v14 STABLE (Danny Build)
// ============================================================================
// ✔ Volledig opgeschoond
// ✔ Geen dubbele PORT definities
// ✔ Geen dubbele functie-definities
// ✔ emitArena correct geïmporteerd
// ✔ fixUsername(), requireUser(), arenaAddPlayer(), arenaEliminatePlayer() OK
// ✔ TikTokGiftEvent opnieuw gedefinieerd
// ✔ Leaderboards → 100% correct
// ✔ Queue / arena / twists volledig werkend
// ✔ √ tsc --noEmit slaagt zonder errors
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool from "./db";

import { startConnection, stopConnection } from "./engines/1-connection";
import { initGiftEngine } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";

import {
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

import { getQueue } from "./queue";
import { giveTwistAdmin, useTwistAdmin } from "./engines/9-admin-twist-engine"; 
import { useTwist } from "./engines/8-twist-engine";

dotenv.config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";
const PORT = Number(process.env.PORT || 4000);

// ============================================================================
// TYPES
// ============================================================================

export interface TikTokGiftEvent {
  giftName: string;
  diamondAmount: number;

  user: {
    id: string;
    username: string;
    display_name: string;
  };

  targetUser: {
    id: string;
    username: string;
    display_name: string;
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function fixUsername(v?: string | null): string {
  if (!v) return "";
  return v.trim().replace(/^@+/, "").toLowerCase();
}

async function requireUser(username: string) {
  const clean = fixUsername(username);
  if (!clean) throw new Error("Username ontbreekt");

  const r = await pool.query(
    `SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [clean]
  );

  if (!r.rows.length) throw new Error(`User @${clean} niet gevonden`);
  return r.rows[0];
}

async function arenaAddPlayer(u: any) {
  return arenaJoin(String(u.tiktok_id), u.display_name, u.username);
}

async function arenaEliminatePlayer(id: string) {
  return arenaLeave(id);
}

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
    id: entry.id ?? Date.now().toString(),
    timestamp: new Date().toISOString(),
    type: entry.type ?? "system",
    message: entry.message ?? "",
  };

  logBuffer.unshift(log);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();

  io.emit("log", log);
}

// ============================================================================
// ACTIVE STREAM + HOST
// ============================================================================

let streamLive = false;
export function setLiveState(v: boolean) {
  streamLive = v;
}
export function isStreamLive() {
  return streamLive;
}

let HARD_HOST_USERNAME = "";
let HARD_HOST_ID: string | null = null;

export function getActiveHost() {
  if (!HARD_HOST_ID) return null;
  return {
    id: HARD_HOST_ID,
    username: HARD_HOST_USERNAME,
    display_name: HARD_HOST_USERNAME,
  };
}

// ============================================================================
// HOST PROFILE LOADING
// ============================================================================

async function loadActiveHostProfile() {
  const r = await pool.query(
    `SELECT username, tiktok_id FROM hosts WHERE active=TRUE LIMIT 1`
  );

  if (!r.rows.length) {
    HARD_HOST_USERNAME = "";
    HARD_HOST_ID = null;
    return;
  }

  HARD_HOST_USERNAME = r.rows[0].username;
  HARD_HOST_ID = String(r.rows[0].tiktok_id);
}

// ============================================================================
// QUEUE EMITTER
// ============================================================================

export async function emitQueue() {
  const rows = await getQueue();
  io.emit("updateQueue", { open: true, entries: rows });
}

// ============================================================================
// LEADERBOARDS
// ============================================================================

let currentGameId: number | null = null;
(io as any).currentGameId = null;

// PLAYERS
export async function broadcastPlayerLeaderboard() {
  const r = await pool.query(`
    SELECT username, display_name, tiktok_id,
           (diamonds_total + diamonds_current_round) AS total_diamonds
    FROM users
    WHERE (diamonds_total + diamonds_current_round) > 0
    ORDER BY total_diamonds DESC
    LIMIT 200
  `);

  io.emit("leaderboardPlayers", r.rows);
}

// GIFTERS
export async function broadcastGifterLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardGifters", []);
    return;
  }

  const rows = await pool.query(
    `
    SELECT giver_id AS user_id,
           giver_username AS username,
           giver_display_name AS display_name,
           SUM(diamonds) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
    GROUP BY giver_id, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
    LIMIT 200
    `,
    [currentGameId]
  );

  io.emit("leaderboardGifters", rows.rows);
}

// ============================================================================
// STATS
// ============================================================================

export async function broadcastStats() {
  if (!currentGameId) return;

  const r = await pool.query(
    `
      SELECT
        COUNT(DISTINCT receiver_id) AS total_players,
        COALESCE(SUM(diamonds), 0) AS total_player_diamonds,
        0 AS total_host_diamonds
      FROM gifts
      WHERE game_id=$1
    `,
    [currentGameId]
  );

  io.emit("streamStats", r.rows[0] || {});
}

// ============================================================================
// TIKTOK CONNECTION
// ============================================================================

let tiktokConn: any = null;
let isConnected = false;

async function fullyDisconnect() {
  try {
    if (tiktokConn) await stopConnection(tiktokConn);
  } catch {}
  tiktokConn = null;
  isConnected = false;
  setLiveState(false);
  io.emit("connectState", { connected: false });
}

export async function restartTikTokConnection() {
  await fullyDisconnect();
  await loadActiveHostProfile();

  if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
    emitLog({ type: "warn", message: "Geen actieve host — idle mode" });
    return;
  }

  const { conn } = await startConnection(
    HARD_HOST_USERNAME,
    () => fullyDisconnect()
  );

  if (!conn) {
    emitLog({ type: "warn", message: "Host offline" });
    return;
  }

  tiktokConn = conn;
  isConnected = true;
  setLiveState(true);

  io.emit("connectState", {
    connected: true,
    host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID },
  });

  initGiftEngine(conn);
  initChatEngine(conn);

  if (currentGameId) {
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
  }
}

// ============================================================================
// ADMIN AUTH
// ============================================================================

interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

io.use((socket: AdminSocket, next) => {
  if (socket.handshake.auth?.token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }
  next(new Error("Unauthorized"));
});

// ============================================================================
// INITIAL SNAPSHOT BUILDER
// ============================================================================

async function buildInitialSnapshot() {
  const snap: any = {};

  snap.arena = getArena();
  snap.queue = { open: true, entries: await getQueue() };

  snap.logs = logBuffer;

  snap.settings = getArenaSettings();

  snap.gameSession = {
    active: currentGameId !== null,
    gameId: currentGameId,
  };

  // STATS
  if (currentGameId) {
    const r = await pool.query(
      `
      SELECT COUNT(DISTINCT receiver_id) AS total_players,
             COALESCE(SUM(diamonds),0) AS total_player_diamonds
      FROM gifts WHERE game_id=$1
      `,
      [currentGameId]
    );
    snap.stats = r.rows[0] || {};
  } else {
    snap.stats = null;
  }

  // PLAYER LEADERBOARD
  const pl = await pool.query(`
    SELECT username, display_name, tiktok_id,
           (diamonds_total + diamonds_current_round) AS total_diamonds
    FROM users
    WHERE (diamonds_total + diamonds_current_round) > 0
    ORDER BY total_diamonds DESC
    LIMIT 200
  `);
  snap.playerLeaderboard = pl.rows;

  // GIFTERS
  if (currentGameId) {
    const gf = await pool.query(
      `
      SELECT giver_id AS user_id,
             giver_username AS username,
             giver_display_name AS display_name,
             SUM(diamonds) AS total_diamonds
      FROM gifts
      WHERE game_id=$1
      GROUP BY giver_id, giver_username, giver_display_name
      ORDER BY total_diamonds DESC
      LIMIT 200
      `,
      [currentGameId]
    );
    snap.gifterLeaderboard = gf.rows;
  } else {
    snap.gifterLeaderboard = [];
  }

  return snap;
}

// ============================================================================
// MAIN SOCKET HANDLER
// ============================================================================

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  // SEND INITIAL (legacy)
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", {
    open: true,
    entries: await getQueue(),
  });
  socket.emit("settings", getArenaSettings());

  socket.emit("connectState", {
    connected: isConnected,
    host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID },
  });

  const hosts = await pool.query(
    `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
  );
  socket.emit("hosts", hosts.rows);

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  if (currentGameId) {
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
  }

  // NEW SNAPSHOT (UI gebruikt deze)
  socket.on("admin:getInitialSnapshot", async (_p, ack) => {
    const snap = await buildInitialSnapshot();
    ack(snap);
  });

  // ========================================================================
  // ADMIN WRAPPER — ALLE COMMANDO'S
  // ========================================================================
  async function handle(action: string, data: any, ack: Function) {
    try {
      // ------------------------------------------
      // HOST CRUD
      // ------------------------------------------
      if (action === "getHosts") {
        const r = await pool.query(
          `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
        );
        return ack({ success: true, hosts: r.rows });
      }

      if (action === "createHost") {
        const label = (data?.label || "").trim();
        const un = fixUsername(data?.username);
        const id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!label || !un || !id)
          return ack({
            success: false,
            message: "label, username, tiktok_id verplicht",
          });

        await pool.query(
          `INSERT INTO hosts (label, username, tiktok_id, active)
           VALUES ($1,$2,$3,FALSE)`,
          [label, un, id]
        );

        emitLog({
          type: "system",
          message: `Host-profiel toegevoegd: ${label} (@${un})`,
        });

        return ack({ success: true });
      }

      if (action === "deleteHost") {
        const id = data?.id;
        if (!id)
          return ack({ success: false, message: "id verplicht" });

        const check = await pool.query(
          `SELECT active FROM hosts WHERE id=$1`,
          [id]
        );

        if (check.rows[0]?.active)
          return ack({
            success: false,
            message: "Kan actieve host niet verwijderen",
          });

        await pool.query(`DELETE FROM hosts WHERE id=$1`, [id]);

        emitLog({
          type: "system",
          message: `Host-profiel verwijderd (#${id})`,
        });

        return ack({ success: true });
      }

      if (action === "setActiveHost") {
        const id = data?.id;
        if (!id)
          return ack({ success: false, message: "id verplicht" });

        const find = await pool.query(
          `SELECT * FROM hosts WHERE id=$1`,
          [id]
        );

        if (!find.rows.length)
          return ack({
            success: false,
            message: "Host-profiel niet gevonden",
          });

        await pool.query(`UPDATE hosts SET active=FALSE`);
        await pool.query(`UPDATE hosts SET active=TRUE WHERE id=$1`, [id]);

        HARD_HOST_USERNAME = find.rows[0].username;
        HARD_HOST_ID = String(find.rows[0].tiktok_id);

        emitLog({
          type: "system",
          message: `Actieve host → @${HARD_HOST_USERNAME}`,
        });

        await restartTikTokConnection();

        io.emit("hostsActiveChanged", {
          username: HARD_HOST_USERNAME,
          tiktok_id: HARD_HOST_ID,
        });

        return ack({ success: true });
      }

      // ------------------------------------------
      // GAME MANAGEMENT
      // ------------------------------------------
      if (action === "startGame") {
        const r = await pool.query(
          `INSERT INTO games (status) VALUES ('running') RETURNING id`
        );
        currentGameId = r.rows[0].id;
        (io as any).currentGameId = currentGameId;

        // RESET USERS
        await pool.query(`
          UPDATE users
          SET diamonds_total = 0,
              diamonds_current_round = 0,
              diamonds_stream = 0
        `);

        await pool.query(`TRUNCATE gifts`);
        await arenaClear();

        emitLog({
          type: "system",
          message: `Nieuw spel gestart (#${currentGameId})`,
        });

        io.emit("gameSession", {
          active: true,
          gameId: currentGameId,
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId) return ack({ success: true });

        await pool.query(
          `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1`,
          [currentGameId]
        );

        await pool.query(`
          UPDATE users
          SET diamonds_total = 0,
              diamonds_current_round = 0,
              diamonds_stream = 0
        `);

        await pool.query(`TRUNCATE gifts`);

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({ type: "system", message: `Spel beëindigd` });

        io.emit("gameSession", {
          active: false,
          gameId: null,
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        return ack({ success: true });
      }

      if (action === "hardResetGame") {
        await pool.query(`UPDATE games SET status='ended' WHERE status='running'`);
        await pool.query(`DELETE FROM queue`);

        await pool.query(`
          UPDATE users
          SET diamonds_total = 0,
              diamonds_current_round = 0,
              diamonds_stream = 0
        `);

        await pool.query(`TRUNCATE gifts`);

        await arenaClear();

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({ type: "system", message: "⚠ HARD RESET uitgevoerd" });

        io.emit("gameSession", { active: false, gameId: null });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        return ack({ success: true });
      }

      // ------------------------------------------
      // ROUNDS
      // ------------------------------------------
      if (action === "startRound") {
        const type = data?.type || "quarter";
        await startRound(type);
        emitArena();
        return ack({ success: true });
      }

      if (action === "endRound") {
        await endRound();
        emitArena();
        await broadcastPlayerLeaderboard();
        return ack({ success: true });
      }

      if (action === "updateSettings") {
        await updateArenaSettings(data);
        socket.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

    // ====================================================================
      // SEARCH USERS
      // ====================================================================
      if (action === "searchUsers") {
        const q = (data?.query || "").trim().toLowerCase();
        if (!q || q.length < 2) return ack({ users: [] });

        const like = `%${q}%`;
        const r = await pool.query(
          `
          SELECT tiktok_id, username, display_name
          FROM users
          WHERE LOWER(username) LIKE LOWER($1)
             OR LOWER(display_name) LIKE LOWER($1)
          ORDER BY last_seen_at DESC NULLS LAST
          LIMIT 25
        `,
          [like]
        );

        return ack({ users: r.rows });
      }

      // ====================================================================
      // QUEUE MANAGEMENT
      // ====================================================================
      if (action === "addToQueue") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });

        const u = await requireUser(username);

        await pool.query(
          `
          INSERT INTO queue (user_tiktok_id, boost_spots, joined_at)
          VALUES ($1,0,NOW())
          ON CONFLICT (user_tiktok_id) DO NOTHING
        `,
          [u.tiktok_id]
        );

        emitLog({ type: "queue", message: `${u.display_name} toegevoegd aan queue` });
        await emitQueue();
        return ack({ success: true });
      }

      if (action === "removeFromQueue") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });

        const u = await requireUser(username);

        await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [u.tiktok_id]);

        emitLog({ type: "queue", message: `${u.display_name} verwijderd uit queue` });
        await emitQueue();
        return ack({ success: true });
      }

      if (action === "promoteUser") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });
        const u = await requireUser(username);

        await pool.query(
          `UPDATE queue SET boost_spots = boost_spots + 1 WHERE user_tiktok_id=$1`,
          [u.tiktok_id]
        );

        emitLog({ type: "queue", message: `${u.display_name} +1 boost` });
        await emitQueue();
        return ack({ success: true });
      }

      if (action === "demoteUser") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });
        const u = await requireUser(username);

        await pool.query(
          `UPDATE queue SET boost_spots = GREATEST(boost_spots - 1, 0)
           WHERE user_tiktok_id=$1`,
          [u.tiktok_id]
        );

        emitLog({ type: "queue", message: `${u.display_name} -1 boost` });
        await emitQueue();
        return ack({ success: true });
      }

      // ====================================================================
      // ARENA MANAGEMENT
      // ====================================================================
      if (action === "addToArena") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });

        const u = await requireUser(username);

        await arenaAddPlayer(u);
        emitArena();

        emitLog({ type: "arena", message: `${u.display_name} naar arena` });
        return ack({ success: true });
      }

      if (action === "eliminate") {
        const username = fixUsername(data?.username);
        if (!username) return ack({ success: false, message: "Geen username" });

        const u = await requireUser(username);

        await arenaEliminatePlayer(u.tiktok_id);
        emitArena();

        emitLog({ type: "elim", message: `${u.display_name} geëlimineerd` });
        return ack({ success: true });
      }

      // ====================================================================
      // PREMIUM FEATURES
      // ====================================================================
      if (action === "giveVip") {
        const u = await requireUser(fixUsername(data?.username));

        await pool.query(
          `
          UPDATE users
          SET is_vip=TRUE,
              vip_expires_at = NOW() + interval '30 days'
          WHERE tiktok_id=$1
        `,
          [u.tiktok_id]
        );

        emitLog({ type: "vip", message: `${u.display_name} kreeg VIP` });
        return ack({ success: true });
      }

      if (action === "removeVip") {
        const u = await requireUser(fixUsername(data?.username));

        await pool.query(
          `
          UPDATE users
          SET is_vip=FALSE,
              vip_expires_at=NULL
          WHERE tiktok_id=$1
        `,
          [u.tiktok_id]
        );

        emitLog({ type: "vip", message: `${u.display_name} VIP verwijderd` });
        return ack({ success: true });
      }

      if (action === "giveFan") {
        const u = await requireUser(fixUsername(data?.username));

        await pool.query(
          `
          UPDATE users
          SET is_fan=TRUE,
              fan_expires_at = NOW() + interval '30 days'
          WHERE tiktok_id=$1
        `,
          [u.tiktok_id]
        );

        emitLog({ type: "fan", message: `${u.display_name} werd FAN` });
        return ack({ success: true });
      }

      // ====================================================================
      // TWISTS — ADMIN
      // ====================================================================
      if (action === "giveTwist") {
        await giveTwistAdmin(fixUsername(data.username), data.twist);
        return ack({ success: true });
      }

      if (action === "useTwist") {
        await useTwistAdmin(
          fixUsername(data.username),
          data.twist,
          fixUsername(data.target || "")
        );

        emitArena();
        return ack({ success: true });
      }

      // ====================================================================
      // FALLBACK
      // ====================================================================
      return ack({ success: false, message: "Onbekend admin commando" });
    } catch (err: any) {
      console.error("Admin error:", err);
      return ack({
        success: false,
        message: err?.message || "Server error",
      });
    }
  }

  // Catch-all voor ALLE admin:* events
  socket.onAny((event, payload, ack) => {
    if (typeof ack !== "function") ack = () => {};
    handle(event.replace("admin:", ""), payload, ack);
  });
});

// ============================================================================
// SERVER LISTEN
// ============================================================================
server.listen(PORT, () => {
  console.log(`🚀 Backend live op poort ${PORT}`);
});
