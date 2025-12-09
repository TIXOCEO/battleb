// ============================================================================
// server.ts — BATTLEBOX BACKEND v16.8 (Full Sync Build, Patched & Cleaned)
// ============================================================================
// - Queue ↔ Arena perfect gesynchroniseerd
// - Identifier resolution correct (id/username/display)
// - Removal werkt altijd (queue + arena)
// - Geen dubbele handler-blokken (fix voor jouw file)
// - Overlay events stabiel
// - Host username normalisatie → host gifts werken weer
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
  loadArenaSettingsFromDB
} from "./engines/5-game-engine";

// Queue Engine v16
import {
  getQueue,
  addToQueue,
  removeFromQueue,
  promoteQueue,
  demoteQueue,
  normalizePositions,
  pushQueueUpdate,
  addToQueueAdminOverride
} from "./queue";

// Queue events
import { emitQueueEvent } from "./queue-events";

// Twists
import { giveTwistAdmin, useTwistAdmin } from "./engines/9-admin-twist-engine";

dotenv.config();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";
const PORT = Number(process.env.PORT || 4000);

// ============================================================================
// STREAM STATE
// ============================================================================
let streamLive = false;

export function setLiveState(v: boolean) {
  streamLive = v;
  io.to("admins").emit("connectState", { connected: v });
}

export function isStreamLive() {
  return streamLive;
}

// ============================================================================
// LOGGING BUFFER (ADMIN ONLY)
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

  io.to("admins").emit("log", log);
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
// AUTH — Admins & Overlays
// ============================================================================
interface AdminSocket extends Socket {
  isAdmin?: boolean;
  isOverlay?: boolean;
}

io.use((socket: AdminSocket, next) => {
  const auth = socket.handshake.auth || {};

  if (auth.token === ADMIN_TOKEN) {
    socket.isAdmin = true;
    return next();
  }

  if (auth.type === "overlay") {
    socket.isOverlay = true;
    return next();
  }

  return next(new Error("Unauthorized"));
});

// ============================================================================
// HOST STATE
// ============================================================================

let HARD_HOST_USERNAME = "";
let HARD_HOST_ID: string | null = null;

/** ⬇ Belangrijk: maakt host-username ALTIJD lowercase (fix host-gift) */
async function loadActiveHostProfile() {
  const r = await pool.query(
    `SELECT username, tiktok_id
     FROM hosts
     WHERE active=TRUE
     LIMIT 1`
  );

  if (!r.rows.length) {
    HARD_HOST_USERNAME = "";
    HARD_HOST_ID = null;
    return;
  }

  HARD_HOST_USERNAME = String(r.rows[0].username || "").toLowerCase();
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
// LEADERBOARDS
// ============================================================================
export async function broadcastPlayerLeaderboard() {
  if (!currentGameId) {
    io.to("overlays").emit("leaderboardPlayers", []);
    io.to("overlays").emit("leaderboardPlayersSummary", 0);
    return;
  }

  const hostId = HARD_HOST_ID ? BigInt(HARD_HOST_ID) : null;

  const q = await pool.query(
    `
    SELECT receiver_id AS tiktok_id,
           receiver_username AS username,
           receiver_display_name AS display_name,
           SUM(diamonds) AS total_score
    FROM gifts
    WHERE game_id=$1
      AND is_round_gift = TRUE
      AND COALESCE(receiver_role,'speler')='speler'
      AND receiver_id IS NOT NULL
      AND ($2::bigint IS NULL OR receiver_id <> $2)
    GROUP BY receiver_id, receiver_username, receiver_display_name
    ORDER BY total_score DESC
    LIMIT 200
    `,
    [currentGameId, hostId]
  );

  const rows = q.rows.map(r => ({
    ...r,
    total_score: Number(r.total_score || 0)
  }));

  const summary = rows.reduce((acc, r) => acc + r.total_score, 0);

  io.to("overlays").emit("leaderboardPlayers", rows);
  io.to("overlays").emit("leaderboardPlayersSummary", summary);
}

export async function broadcastGifterLeaderboard() {
  if (!currentGameId) {
    io.to("overlays").emit("leaderboardGifters", []);
    io.to("overlays").emit("leaderboardGiftersSummary", 0);
    return;
  }

  const r = await pool.query(
    `
    SELECT giver_id AS user_id,
           giver_username AS username,
           giver_display_name AS display_name,
           SUM(diamonds) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
      AND (round_active = TRUE OR is_host_gift = TRUE)
    GROUP BY giver_id, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
    LIMIT 200
    `,
    [currentGameId]
  );

  const rows = r.rows.map(x => ({
    ...x,
    total_diamonds: Number(x.total_diamonds || 0)
  }));

  io.to("overlays").emit("leaderboardGifters", rows);
  io.to("overlays").emit(
    "leaderboardGiftersSummary",
    rows.reduce((a, b) => a + b.total_diamonds, 0)
  );
}

export async function broadcastHostDiamonds() {
  if (!currentGameId || !HARD_HOST_ID) {
    io.to("overlays").emit("hostDiamonds", { username: "", total: 0 });
    return;
  }

  const q = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS total 
     FROM gifts 
     WHERE game_id=$1 AND is_host_gift=TRUE`,
    [currentGameId]
  );

  io.to("overlays").emit("hostDiamonds", {
    username: HARD_HOST_USERNAME,
    total: Number(q.rows[0].total || 0)
  });
}

// ============================================================================
// STREAM STATS
// ============================================================================
export async function broadcastStats() {
  if (!currentGameId) {
    return io.to("overlays").emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0
    });
  }

  const r = await pool.query(
    `
    SELECT COUNT(DISTINCT receiver_id) AS total_players,
           COALESCE(SUM(diamonds),0) AS total_player_diamonds
    FROM gifts 
    WHERE game_id=$1 
      AND is_round_gift=TRUE
      AND COALESCE(receiver_role,'speler')='speler'
    `,
    [currentGameId]
  );

  const h = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds),0) AS total
    FROM gifts
    WHERE game_id=$1 AND is_host_gift=TRUE
    `,
    [currentGameId]
  );

  io.to("overlays").emit("streamStats", {
    totalPlayers: Number(r.rows[0]?.total_players || 0),
    totalPlayerDiamonds: Number(r.rows[0]?.total_player_diamonds || 0),
    totalHostDiamonds: Number(h.rows[0]?.total || 0)
  });
}

// ============================================================================
// TIKTOK CONNECT FLOW
// ============================================================================
let tiktokConn: any = null;

async function fullyDisconnect() {
  try {
    if (tiktokConn) await stopConnection(tiktokConn);
  } catch {}
  tiktokConn = null;
  setLiveState(false);
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
    setLiveState(false);
    return;
  }

  tiktokConn = conn;
  setLiveState(true);

  io.to("admins").emit("connectState", {
    connected: true,
    host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID }
  });

  initGiftEngine(conn);
  initChatEngine(conn);

  if (currentGameId) {
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();
    await broadcastStats();
  }
}

// ============================================================================
// QUEUE PROMOTE/DEMOTE HELPERS
// ============================================================================
async function promoteQueueByUsername(username: string) {
  const r = await pool.query(
    `SELECT tiktok_id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username]
  );

  if (!r.rows.length) return;

  await promoteQueue(String(r.rows[0].tiktok_id));
  await normalizePositions();
  await pushQueueUpdate();
}

async function demoteQueueByUsername(username: string) {
  const r = await pool.query(
    `SELECT tiktok_id FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username]
  );

  if (!r.rows.length) return;

  await demoteQueue(String(r.rows[0].tiktok_id));
  await normalizePositions();
  await pushQueueUpdate();
}

// ============================================================================
// SNAPSHOT GENERATOR
// ============================================================================
async function buildInitialSnapshot() {
  const snap: any = {};

  snap.arena = getArena();
  snap.queue = { open: true, entries: await getQueue() };
  snap.logs = logBuffer;
  snap.settings = getArenaSettings();
  snap.gameSession = {
    active: currentGameId !== null,
    gameId: currentGameId
  };

  if (currentGameId) {
    const r = await pool.query(
      `
      SELECT COUNT(DISTINCT receiver_id) AS total_players,
             COALESCE(SUM(diamonds),0) AS total_player_diamonds
      FROM gifts
      WHERE game_id=$1
        AND is_round_gift=TRUE
        AND COALESCE(receiver_role,'speler')='speler'
      `,
      [currentGameId]
    );

    const h = await pool.query(
      `
      SELECT COALESCE(SUM(diamonds),0) AS total
      FROM gifts
      WHERE game_id=$1 AND is_host_gift=TRUE
      `,
      [currentGameId]
    );

    snap.stats = {
      totalPlayers: Number(r.rows[0]?.total_players || 0),
      totalPlayerDiamonds: Number(r.rows[0]?.total_player_diamonds || 0),
      totalHostDiamonds: Number(h.rows[0]?.total || 0)
    };
  } else {
    snap.stats = null;
  }

  if (currentGameId) {
    const hostId = HARD_HOST_ID ? BigInt(HARD_HOST_ID) : null;

    const pl = await pool.query(
      `
      SELECT receiver_id AS tiktok_id,
             receiver_username AS username,
             receiver_display_name AS display_name,
             SUM(diamonds) AS total_score
      FROM gifts
      WHERE game_id=$1
        AND is_round_gift=TRUE
        AND COALESCE(receiver_role,'speler')='speler'
        AND receiver_id IS NOT NULL
        AND ($2::bigint IS NULL OR receiver_id <> $2)
      GROUP BY receiver_id, receiver_username, receiver_display_name
      ORDER BY total_score DESC
      LIMIT 200
      `,
      [currentGameId, hostId]
    );

    const rows = pl.rows.map(r => ({
      ...r,
      total_score: Number(r.total_score || 0)
    }));

    snap.playerLeaderboard = rows;
    snap.playerLeaderboardSummary = rows.reduce(
      (acc, r) => acc + r.total_score,
      0
    );
  } else {
    snap.playerLeaderboard = [];
    snap.playerLeaderboardSummary = 0;
  }

  return snap;
}

// ============================================================================
// SOCKET CONNECT — ADMIN + OVERLAY
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin && !socket.isOverlay) return socket.disconnect();

  // OVERLAY CONNECT
  if (socket.isOverlay) {
    socket.join("overlays");
    const snap = await buildInitialSnapshot();
    socket.emit("overlayInitialSnapshot", snap);
    return;
  }

  // ADMIN CONNECT
  if (socket.isAdmin) {
    socket.join("admins");

    socket.emit("initialLogs", logBuffer);
    socket.emit("updateArena", getArena());
    socket.emit("updateQueue", { open: true, entries: await getQueue() });
    socket.emit("settings", getArenaSettings());

    socket.emit("connectState", {
      connected: isStreamLive(),
      host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID }
    });

    const hosts = await pool.query(
      `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
    );
    socket.emit("hosts", hosts.rows);

    socket.emit("gameSession", {
      active: currentGameId !== null,
      gameId: currentGameId
    });

    if (currentGameId) {
      await broadcastPlayerLeaderboard();
      await broadcastGifterLeaderboard();
      await broadcastHostDiamonds();
      await broadcastStats();
    }

    // ADMIN -> vraagt volledige snapshot
    socket.on("getInitialSnapshot", async (_payload, ack) => {
      const snap = await buildInitialSnapshot();
      ack(snap);
    });
  }
});

// ============================================================================
// RESOLVE USER IDENTIFIER
// ============================================================================
async function resolveUserIdentifier(input: string) {
  if (!input) return null;

  const clean = input.trim().replace(/^@+/, "").toLowerCase();

  // TikTok ID (exact numeric)
  if (/^\d+$/.test(clean)) {
    const r = await pool.query(
      `SELECT tiktok_id, username, display_name, avatar_url
       FROM users WHERE tiktok_id=$1 LIMIT 1`,
      [clean]
    );
    if (r.rows.length) return r.rows[0];
  }

  // Match username
  let r = await pool.query(
    `SELECT tiktok_id, username, display_name, avatar_url
     FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [clean]
  );
  if (r.rows.length) return r.rows[0];

  // Match display_name
  r = await pool.query(
    `SELECT tiktok_id, username, display_name, avatar_url
     FROM users WHERE LOWER(display_name)=LOWER($1) LIMIT 1`,
    [clean]
  );
  if (r.rows.length) return r.rows[0];

  return null;
}

// ============================================================================
// ADMIN ACTION HANDLER
// ============================================================================
io.on("connection", (socket: AdminSocket) => {
  if (!socket.isAdmin) return;

  async function handle(action: string, data: any, ack: Function) {
    try {
      // ----------------------------------------------------------------------
      // HOST MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "getHosts") {
        const r = await pool.query(
          `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
        );
        return ack({ success: true, hosts: r.rows });
      }

      if (action === "createHost") {
        const label = (data?.label || "").trim();
        const un = (data?.username || "")
          .trim()
          .replace(/^@+/, "")
          .toLowerCase();
        const id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!label || !un || !id)
          return ack({
            success: false,
            message: "label, username en tiktok_id verplicht"
          });

        await pool.query(
          `INSERT INTO hosts (label, username, tiktok_id, active)
           VALUES ($1,$2,$3,FALSE)`,
          [label, un, id]
        );

        emitLog({
          type: "system",
          message: `Host toegevoegd: ${label} (@${un})`
        });

        return ack({ success: true });
      }

      if (action === "deleteHost") {
        const id = data?.id;
        if (!id) return ack({ success: false, message: "id verplicht" });

        const check = await pool.query(`SELECT active FROM hosts WHERE id=$1`, [
          id
        ]);
        if (check.rows[0]?.active)
          return ack({
            success: false,
            message: "Kan actieve host niet verwijderen"
          });

        await pool.query(`DELETE FROM hosts WHERE id=$1`, [id]);

        emitLog({ type: "system", message: `Host verwijderd (#${id})` });
        return ack({ success: true });
      }

      if (action === "setActiveHost") {
        const id = data?.id;
        if (!id) return ack({ success: false, message: "id verplicht" });

        const find = await pool.query(`SELECT * FROM hosts WHERE id=$1`, [id]);
        if (!find.rows.length)
          return ack({ success: false, message: "Host niet gevonden" });

        await pool.query(`UPDATE hosts SET active=FALSE`);
        await pool.query(`UPDATE hosts SET active=TRUE WHERE id=$1`, [id]);

        HARD_HOST_USERNAME = find.rows[0].username;
        HARD_HOST_ID = String(find.rows[0].tiktok_id);

        emitLog({
          type: "system",
          message: `Actieve host is nu @${HARD_HOST_USERNAME}`
        });

        await restartTikTokConnection();

        io.to("admins").emit("hostsActiveChanged", {
          username: HARD_HOST_USERNAME,
          tiktok_id: HARD_HOST_ID
        });

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // GAME MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "startGame") {
        const r = await pool.query(`
          INSERT INTO games (status, started_at)
          VALUES ('running', NOW())
          RETURNING id
        `);

        currentGameId = r.rows[0].id;
        (io as any).currentGameId = currentGameId;

        await arenaClear();

        emitLog({
          type: "system",
          message: `Nieuw spel gestart (#${currentGameId})`
        });

        io.to("admins").emit("gameSession", {
          active: true,
          gameId: currentGameId
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();
        await broadcastStats();

        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId) return ack({ success: true });

        await pool.query(
          `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1`,
          [currentGameId]
        );

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({ type: "system", message: "Spel beëindigd" });

        io.to("admins").emit("gameSession", {
          active: false,
          gameId: null
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();
        await broadcastStats();

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // ROUND MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "startRound") {
        const type = data?.type === "finale" ? "finale" : "quarter";

        try {
          await startRound(type);
        } catch (e: any) {
          return ack({
            success: false,
            message: e?.message || "Kon ronde niet starten"
          });
        }

        await emitArena();
        await broadcastPlayerLeaderboard();
        await broadcastStats();

        return ack({ success: true });
      }

      if (action === "endRound") {
        await endRound(true);

        await emitArena();
        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();
        await broadcastStats();

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // ARENA MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "addToArena") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        if (String(user.tiktok_id) === HARD_HOST_ID)
          return ack({ success: false, message: "Host kan niet in arena staan" });

        await removeFromQueue(String(user.tiktok_id));

        emitQueueEvent("leave", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        await arenaJoin(
          String(user.tiktok_id),
          user.display_name,
          user.username,
          user.avatar_url ?? null
        );

        await emitArena();

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        emitLog({
          type: "arena",
          message: `${user.display_name} toegevoegd aan arena`
        });

        return ack({ success: true });
      }

      if (action === "eliminate") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await arenaLeave(String(user.tiktok_id)); // soft
        await removeFromQueue(String(user.tiktok_id));

        emitQueueEvent("leave", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        await emitArena();

        emitLog({
          type: "elim",
          message: `${user.display_name} geëlimineerd`
        });

        return ack({ success: true });
      }

      if (action === "removeFromArenaPermanent") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await arenaLeave(String(user.tiktok_id), true);
        await removeFromQueue(String(user.tiktok_id));

        emitQueueEvent("leave", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        await emitArena();

        emitLog({
          type: "arena",
          message: `${user.display_name} permanent uit arena verwijderd`
        });

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // SEARCH USERS
      // ----------------------------------------------------------------------
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
          ORDER BY username ASC LIMIT 25
          `,
          [like]
        );

        return ack({ users: r.rows });
      }

      // ----------------------------------------------------------------------
      // QUEUE MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "addToQueue") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        if (String(user.tiktok_id) === HARD_HOST_ID)
          return ack({ success: false, message: "Host kan niet in queue staan" });

        const exists = await pool.query(
          `SELECT 1 FROM queue WHERE user_tiktok_id=$1`,
          [user.tiktok_id]
        );

        if (!exists.rows.length) {
          await addToQueueAdminOverride(
            String(user.tiktok_id),
            user.username
          );

          emitQueueEvent("join", {
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url || null
          });
        }

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      if (action === "removeFromQueue") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await removeFromQueue(String(user.tiktok_id));

        emitQueueEvent("leave", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      // Promote
      if (action === "promoteUser") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await promoteQueue(String(user.tiktok_id));
        await normalizePositions();
        await pushQueueUpdate();

        emitQueueEvent("promote", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      // Demote
      if (action === "demoteUser") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await demoteQueue(String(user.tiktok_id));
        await normalizePositions();
        await pushQueueUpdate();

        emitQueueEvent("demote", {
          username: user.username,
          display_name: user.display_name,
          avatar_url: user.avatar_url || null
        });

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // VIP MANAGEMENT
      // ----------------------------------------------------------------------
      if (action === "giveVip") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await pool.query(
          `
          UPDATE users
          SET is_vip=TRUE,
              vip_expires_at = NOW() + interval '30 days'
          WHERE tiktok_id=$1
          `,
          [user.tiktok_id]
        );

        emitLog({ type: "vip", message: `${user.display_name} kreeg VIP` });

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      if (action === "removeVip") {
        const user = await resolveUserIdentifier(data?.username);
        if (!user)
          return ack({ success: false, message: "User niet gevonden" });

        await pool.query(
          `
          UPDATE users
          SET is_vip=FALSE,
              vip_expires_at=NULL
          WHERE tiktok_id=$1
          `,
          [user.tiktok_id]
        );

        emitLog({
          type: "vip",
          message: `${user.display_name} VIP verwijderd`
        });

        io.to("overlays").emit("updateQueue", {
          open: true,
          entries: await getQueue()
        });

        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // TWISTS
      // ----------------------------------------------------------------------
      if (action === "giveTwist") {
        await giveTwistAdmin(data.username, data.twist);
        return ack({ success: true });
      }

      if (action === "useTwist") {
        await useTwistAdmin(data.username, data.twist, data.target || "");
        await emitArena();
        return ack({ success: true });
      }

      // ----------------------------------------------------------------------
      // UNKNOWN ACTION
      // ----------------------------------------------------------------------
      return ack({ success: false, message: "Onbekend admin commando" });
    } catch (err: any) {
      console.error("Admin error:", err);
      return ack({
        success: false,
        message: err?.message || "Serverfout"
      });
    }
  }

  socket.onAny((event, payload, ack) => {
    if (typeof ack !== "function") ack = () => {};
    handle(event, payload, ack);
  });
});

// ============================================================================
// START SERVER
// ============================================================================
(async () => {
  try {
    await loadArenaSettingsFromDB();
    console.log("✔ Arena settings geladen");

    server.listen(PORT, () => {
      console.log(`🚀 Backend live op poort ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Fout bij server startup:", err);
    process.exit(1);
  }
})();
