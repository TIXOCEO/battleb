// ============================================================================
// server.ts — Undercover BattleBox — v9.2
// VIP Auto-Expire + Admin Give/Remove VIP + Logging
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db";
import { initDB } from "./db";

import { startConnection, stopConnection } from "./engines/1-connection";
import { initGiftEngine } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";

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
import { applyBoost } from "./engines/7-boost-engine";
import { useTwist } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { giveTwistToUser } from "./engines/twist-inventory";

dotenv.config();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// ============================================================================
// SANITIZER
// ============================================================================
function sanitizeHost(v: string | null) {
  if (!v) return "";
  return v
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

// ============================================================================
// VIP AUTO-EXPIRE
// ============================================================================
async function cleanupVIP(tiktokId: string) {
  const r = await pool.query(
    `SELECT is_vip, vip_expires_at, username FROM users WHERE tiktok_id=$1`,
    [BigInt(tiktokId)]
  );

  if (!r.rows.length) return;

  const { is_vip, vip_expires_at, username } = r.rows[0];
  if (!is_vip || !vip_expires_at) return;

  const now = Date.now();
  if (new Date(vip_expires_at).getTime() <= now) {
    await pool.query(
      `UPDATE users SET is_vip=FALSE, vip_expires_at=NULL WHERE tiktok_id=$1`,
      [BigInt(tiktokId)]
    );

    emitLog({
      type: "system",
      message: `VIP verlopen voor @${username} (automatisch)`,
    });
  }
}

// ============================================================================
// FAN AUTO CHECK (bestond al via engines)
// ============================================================================

// ============================================================================
// LIVE STATE
// ============================================================================
let streamLive = false;
export function setLiveState(v: boolean) {
  streamLive = v;
}
export function isStreamLive() {
  return streamLive;
}

// ============================================================================
// ACTIVE HOST
// ============================================================================
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
// EXPRESS + SOCKET
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
// LOG ENGINE
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
// HOST PROFILES
// ============================================================================
app.get("/api/hosts", async (req, res) => {
  const r = await pool.query(
    `SELECT id, label, username, tiktok_id, active
     FROM hosts ORDER BY id`
  );
  res.json({ success: true, hosts: r.rows });
});

// ============================================================================
// TIKTOK ID LOOKUP
// ============================================================================
async function fetchTikTokId(username: string): Promise<string | null> {
  const clean = sanitizeHost(username);
  if (!clean) return null;

  try {
    const res = await fetch(`https://www.tiktok.com/@${clean}`, {
      headers: { "user-agent": "Mozilla/5.0" },
    });

    const html = await res.text();
    const match = html.match(/"id":"(\d{5,30})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

app.get("/api/tiktok-id/:username", async (req, res) => {
  const id = await fetchTikTokId(req.params.username || "");
  if (!id)
    return res.status(404).json({
      success: false,
      message: "Kon TikTok ID niet vinden",
    });

  res.json({ success: true, tiktok_id: id });
});

// ============================================================================
// QUEUE BROADCAST
// ============================================================================
export async function emitQueue() {
  try {
    const q = await getQueue();
    io.emit("updateQueue", { open: true, entries: q });
  } catch (err) {
    console.error("emitQueue:", err);
  }
}

export { emitArena };

// ============================================================================
// LEADERBOARD — REALTIME MODE
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

export async function broadcastPlayerLeaderboard() {
  const res = await pool.query(`
    SELECT username, display_name, tiktok_id, diamonds_total
    FROM users
    WHERE diamonds_total > 0
    ORDER BY diamonds_total DESC
    LIMIT 200
  `);

  io.emit("leaderboardPlayers", res.rows);
}

export async function broadcastGifterLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardGifters", []);
    return;
  }

  const res = await pool.query(
    `
    SELECT giver_id AS user_id,
           giver_username AS username,
           giver_display_name AS display_name,
           SUM(diamonds) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
    GROUP BY giver_id, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
  `,
    [currentGameId]
  );

  io.emit("leaderboardGifters", res.rows);
}

export async function broadcastStats() {
  if (!currentGameId) return;

  const res = await pool.query(
    `
      SELECT
        COUNT(DISTINCT receiver_id) AS total_players,
        COALESCE(SUM(diamonds), 0) AS total_diamonds
      FROM gifts WHERE game_id=$1
    `,
    [currentGameId]
  );

  io.emit("streamStats", res.rows[0] || {});
}

// ============================================================================
// LOAD ACTIVE GAME
// ============================================================================
async function loadActiveGame() {
  const r = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  currentGameId = r.rows[0]?.id || null;
  (io as any).currentGameId = currentGameId;
}

// ============================================================================
// LOAD ACTIVE HOST
// ============================================================================
export async function loadActiveHostProfile() {
  const r = await pool.query(`
    SELECT username, tiktok_id
    FROM hosts WHERE active=TRUE LIMIT 1
  `);

  if (!r.rows.length) {
    HARD_HOST_USERNAME = "";
    HARD_HOST_ID = null;
    return;
  }

  HARD_HOST_USERNAME = r.rows[0].username;
  HARD_HOST_ID = String(r.rows[0].tiktok_id);
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

export async function restartTikTokConnection(first = false) {
  await fullyDisconnect();
  await loadActiveHostProfile();

  if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
    emitLog({
      type: "warn",
      message: "Geen actieve host geselecteerd — IDLE mode",
    });
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
// ADMIN SOCKET HANDLER
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

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

  initAdminTwistEngine(socket);

  // ========================================================================
  // WRAPPER
  // ========================================================================
  async function handle(action: string, data: any, ack: Function) {
    try {
      // --------------------------------------------
      // HOST CRUD
      // --------------------------------------------
      if (action === "getHosts") {
        const r = await pool.query(
          `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
        );
        return ack({ success: true, hosts: r.rows });
      }

      if (action === "createHost") {
        const label = (data?.label || "").trim();
        const un = sanitizeHost(data?.username || "");
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
        await pool.query(
          `UPDATE hosts SET active=TRUE WHERE id=$1`,
          [id]
        );

        HARD_HOST_USERNAME = find.rows[0].username;
        HARD_HOST_ID = String(find.rows[0].tiktok_id);

        emitLog({
          type: "system",
          message: `Actieve host → @${HARD_HOST_USERNAME}`,
        });

        await restartTikTokConnection(true);

        io.emit("hostsActiveChanged", {
          username: HARD_HOST_USERNAME,
          tiktok_id: HARD_HOST_ID,
        });

        return ack({ success: true });
      }

      // ==================================================================
      // VIP MANAGEMENT
      // ==================================================================
      if (action === "giveVIP") {
        const tid = BigInt(data.tiktok_id);
        const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);

        await pool.query(
          `UPDATE users
           SET is_vip=TRUE, vip_expires_at=$1
           WHERE tiktok_id=$2`,
          [expires, tid]
        );

        emitLog({
          type: "system",
          message: `VIP gegeven aan @${data.username}`,
        });

        await emitQueue();
        return ack({ success: true });
      }

      if (action === "removeVIP") {
        const tid = BigInt(data.tiktok_id);

        await pool.query(
          `UPDATE users
           SET is_vip=FALSE, vip_expires_at=NULL
           WHERE tiktok_id=$1`,
          [tid]
        );

        emitLog({
          type: "system",
          message: `VIP verwijderd bij @${data.username}`,
        });

        await emitQueue();
        return ack({ success: true });
      }

      // ==================================================================
      // GAME MANAGEMENT
      // ==================================================================
      if (action === "startGame") {
        const r = await pool.query(
          `INSERT INTO games (status) VALUES ('running')
           RETURNING id`
        );
        currentGameId = r.rows[0].id;
        (io as any).currentGameId = currentGameId;

        // volledig leegmaken
        await pool.query(`UPDATE users SET diamonds_total = 0`);
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
          `UPDATE games SET status='ended', ended_at=NOW()
           WHERE id=$1`,
          [currentGameId]
        );

        // reset leaderboards
        await pool.query(`UPDATE users SET diamonds_total = 0`);
        await pool.query(`TRUNCATE gifts`);

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({
          type: "system",
          message: `Spel beëindigd`,
        });

        io.emit("gameSession", {
          active: false,
          gameId: null,
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        return ack({ success: true });
      }

      if (action === "hardResetGame") {
        await pool.query(
          `UPDATE games SET status='ended'
           WHERE status='running'`
        );

        await pool.query(`DELETE FROM queue`);

        await pool.query(`UPDATE users SET diamonds_total = 0`);
        await pool.query(`TRUNCATE gifts`);

        await arenaClear();

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({
          type: "system",
          message: "⚠ HARD RESET uitgevoerd",
        });

        io.emit("gameSession", { active: false, gameId: null });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        return ack({ success: true });
      }

      // ==================================================================
      // ROUND MANAGEMENT
      // ==================================================================
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

      // ==================================================================
      // SEARCH USERS
      // ==================================================================
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

      // ==================================================================
      // USER ACTIONS
      // ==================================================================
      if (!data?.username)
        return ack({
          success: false,
          message: "username verplicht",
        });

      const qUser = data.username
        .toString()
        .replace("@", "")
        .trim()
        .toLowerCase();

      let rUser = await pool.query(
        `
        SELECT tiktok_id, display_name, username, is_vip, vip_expires_at
        FROM users
        WHERE LOWER(username)=LOWER($1)
        LIMIT 1
      `,
        [qUser]
      );

      if (!rUser.rows.length) {
        rUser = await pool.query(
          `
        SELECT tiktok_id, display_name, username, is_vip, vip_expires_at
        FROM users
        WHERE LOWER(username) LIKE LOWER($1)
        ORDER BY last_seen_at DESC NULLS LAST
        LIMIT 1
      `,
          [`%${qUser}%`]
        );
      }

      if (!rUser.rows.length)
        return ack({
          success: false,
          message: `Gebruiker @${qUser} niet gevonden`,
        });

      const { tiktok_id, display_name, username, is_vip, vip_expires_at } =
        rUser.rows[0];

      // VIP auto-expire check
      if (is_vip) {
        await cleanupVIP(String(tiktok_id));
      }

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
          emitLog({ type: "queue", message: `${display_name} → queue` });
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

        case "promoteUser":
        case "boostUser":
          await applyBoost(String(tiktok_id), 1, display_name);
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} +1 boost`,
          });
          break;

        case "demoteUser":
          await pool.query(
            `
            UPDATE queue
            SET boost_spots = GREATEST(boost_spots - 1, 0)
            WHERE user_tiktok_id=$1
          `,
            [tiktok_id]
          );
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} -1 boost`,
          });
          break;

        case "useTwist":
          await useTwist(
            String(tiktok_id),
            display_name,
            data.twist,
            data.target
          );
          await broadcastGifterLeaderboard();
          await broadcastPlayerLeaderboard();
          return ack({ success: true });

        case "giveTwist":
          await giveTwistToUser(String(tiktok_id), data.twist);
          emitLog({
            type: "twist",
            message: `ADMIN gaf twist '${data.twist}' → ${display_name}`,
          });
          return ack({ success: true });
      }

      await broadcastGifterLeaderboard();
      await broadcastPlayerLeaderboard();
      return ack({ success: true });
    } catch (err: any) {
      console.error("ADMIN ERROR:", err);
      return ack({
        success: false,
        message: err.message || "Server error",
      });
    }
  }

  // ========================================================================
  // SOCKET ROUTING
  // ============================================================================
  socket.on("admin:getSettings", (d, ack) => handle("getSettings", d, ack));
  socket.on("admin:getHosts", (d, ack) => handle("getHosts", d, ack));
  socket.on("admin:createHost", (d, ack) => handle("createHost", d, ack));
  socket.on("admin:deleteHost", (d, ack) => handle("deleteHost", d, ack));
  socket.on("admin:setActiveHost", (d, ack) => handle("setActiveHost", d, ack));

  socket.on("admin:startGame", (d, ack) => handle("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handle("stopGame", d, ack));
  socket.on("admin:hardResetGame", (d, ack) => handle("hardResetGame", d, ack));

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
  socket.on("admin:boostUser", (d, ack) => handle("boostUser", d, ack));
  socket.on("admin:demoteUser", (d, ack) => handle("demoteUser", d, ack));

  socket.on("admin:useTwist", (d, ack) => handle("useTwist", d, ack));
  socket.on("admin:giveTwist", (d, ack) => handle("giveTwist", d, ack));

  socket.on("admin:searchUsers", (d, ack) => handle("searchUsers", d, ack));
});

// ============================================================================
// START SERVER
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();
  await loadActiveHostProfile();

  await restartTikTokConnection(true);

  console.log("🚀 Server klaar — VIP AUTO-EXPIRE MODE");
});
