// ============================================================================
// server.ts — Undercover BattleBox — v6.0 ULTRA ROUND-LEADERBOARD FINAL
// HARD-HOST-LOCK + TikTok Live Auto-Reconnect + Username Fix +
// Leaderboard (only ROUND diamonds) + Live Refresh
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import pool, { getSetting, setSetting } from "./db";
import { initDB } from "./db";

// TikTok engines
import { startConnection, stopConnection } from "./engines/1-connection";
import { initGiftEngine, refreshHostUsername } from "./engines/3-gift-engine";
import { initChatEngine } from "./engines/6-chat-engine";

// Arena engines
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

// ============================================================================
// HARD HOST LOCK
// ============================================================================
let HARD_HOST_ID: string | null = null;
let HARD_HOST_USERNAME: string = "";

export function getHardHostId() {
  return HARD_HOST_ID;
}
export function getHardHostUsername() {
  return HARD_HOST_USERNAME;
}

// ============================================================================
// STREAM LIVE STATE
// ============================================================================
let streamLive = false;
export function setLiveState(v: boolean) {
  streamLive = v;
}
export function isStreamLive() {
  return streamLive;
}

// ============================================================================
// ENVIRONMENT
// ============================================================================
dotenv.config();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

function sanitizeHost(input: string | null): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
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
// LOG ENGINE
// ============================================================================
type LogEntry = { id: string; timestamp: string; type: string; message: string };
const logBuffer: LogEntry[] = [];
const LOG_MAX = 500;

export function emitLog(entry: Partial<LogEntry>) {
  if (entry?.type === "system" && entry.message?.includes("Admin dashboard")) {
    io.emit("log", {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type: "system",
      message: entry.message,
    });
    return;
  }

  const log: LogEntry = {
    id: entry.id ?? Date.now().toString(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    type: entry.type ?? "system",
    message: entry.message ?? "",
  };

  logBuffer.unshift(log);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();
  io.emit("log", log);
}

// ============================================================================
// TikTok ID Lookup API
// ============================================================================
async function fetchTikTokId(username: string): Promise<string | null> {
  const clean = sanitizeHost(username);
  if (!clean) return null;

  try {
    const res = await fetch(`https://www.tiktok.com/@${clean}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/118 Safari/537.36",
      },
    });

    const html = await res.text();
    const match = html.match(/"id":"(\d{5,30})"/);

    return match?.[1] ?? null;
  } catch (err) {
    console.error("TikTok ID lookup failed:", err);
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
// QUEUE EMITTER
// ============================================================================
export async function emitQueue() {
  try {
    const entries = await getQueue();
    io.emit("updateQueue", { open: true, entries });
  } catch (err) {
    console.error("emitQueue error:", err);
  }
}

export { emitArena };
// ============================================================================
// STREAM STATS + ROUND LEADERBOARD
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

/**
 * Nieuw: leaderboard alleen op basis van ronde-diamonds (is_round_gift = true)
 * Dit is wat je wilde voor de admin UI.
 */
export async function broadcastRoundLeaderboard() {
  if (!currentGameId) {
    io.emit("streamLeaderboard", []);
    return;
  }

  const res = await pool.query(
    `
    SELECT
      giver_id AS user_id,
      giver_username AS username,
      giver_display_name AS display_name,
      SUM(diamonds) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
      AND is_round_gift = TRUE
    GROUP BY giver_id, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
    `,
    [currentGameId]
  );

  io.emit("streamLeaderboard", res.rows);
}

export async function broadcastStats() {
  if (!currentGameId) return;

  const res = await pool.query(
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

  const row = res.rows[0] || {};

  io.emit("streamStats", {
    totalPlayers: Number(row.total_players || 0),
    totalPlayerDiamonds: Number(row.total_player_diamonds || 0),
    totalHostDiamonds: Number(row.total_host_diamonds || 0),
  });
}

// ============================================================================
// GAME SESSION MANAGEMENT
// ============================================================================
async function loadActiveGame() {
  const res = await pool.query(`
    SELECT id
    FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  if (res.rows[0]) {
    currentGameId = res.rows[0].id;
    (io as any).currentGameId = currentGameId;
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
  } else {
    currentGameId = null;
    (io as any).currentGameId = null;
  }
}

async function startNewGame() {
  const res = await pool.query(
    `INSERT INTO games (status) VALUES ('running') RETURNING id, started_at`
  );

  currentGameId = res.rows[0].id;
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
  await broadcastRoundLeaderboard();
}

async function stopCurrentGame() {
  if (!currentGameId) return;

  const res = await pool.query(
    `
      UPDATE games
      SET status='ended', ended_at=NOW()
      WHERE id=$1
      RETURNING ended_at
    `,
    [currentGameId]
  );

  emitLog({
    type: "system",
    message: `Spel beëindigd (#${currentGameId})`,
  });

  io.emit("gameSession", {
    active: false,
    gameId: currentGameId,
    endedAt: res.rows[0]?.ended_at ?? new Date().toISOString(),
  });

  currentGameId = null;
  (io as any).currentGameId = null;

  await broadcastStats();
  await broadcastRoundLeaderboard();
}

// ============================================================================
// HARD RESET
// ============================================================================
async function hardResetGame() {
  await pool.query(`UPDATE games SET status='ended' WHERE status='running'`);
  await pool.query(`DELETE FROM queue`);
  await arenaClear();

  currentGameId = null;
  (io as any).currentGameId = null;

  emitLog({
    type: "system",
    message: "⚠ HARD RESET uitgevoerd. Alles staat weer op idle.",
  });

  io.emit("gameSession", {
    active: false,
    gameId: null,
  });

  await broadcastStats();
  await broadcastRoundLeaderboard();
}

// ============================================================================
// ADMIN SOCKET AUTH
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
// ULTRA RECONNECT ENGINE v3.1
// ============================================================================
let tiktokConn: any = null;
let reconnectLock = false;

let lastEventAt = Date.now();
let healthInterval: NodeJS.Timeout | null = null;

export function markTikTokEvent() {
  lastEventAt = Date.now();
}

async function fullyDisconnect() {
  try {
    if (tiktokConn) await stopConnection(tiktokConn);
  } catch (e) {
    console.log("⚠ stopConnection error:", e);
  }
  tiktokConn = null;
}

function startHealthMonitor() {
  if (healthInterval) return;

  healthInterval = setInterval(async () => {
    const diff = Date.now() - lastEventAt;

    if (diff > 20000) {
      console.log("🛑 HEALTH MONITOR: geen TikTok events >20s → RECONNECT");
      await restartTikTokConnection(true);
    }
  }, 12000);
}

export async function restartTikTokConnection(force = false) {
  if (reconnectLock) return;
  reconnectLock = true;

  try {
    console.log("🔄 RECONNECT ENGINE: start…");

    await fullyDisconnect();

    const confUser = sanitizeHost(await getSetting("host_username"));
    const confId = await getSetting("host_id");

    HARD_HOST_USERNAME = confUser || "";
    HARD_HOST_ID = confId ? String(confId) : null;

    if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
      console.log("❌ GEEN HARD-HOST INGESTELD — admin:setHost nodig");
      emitLog({
        type: "warn",
        message: "Geen hard-host ingesteld. Ga naar Admin → Settings.",
      });

      io.emit("streamStats", {
        totalPlayers: 0,
        totalPlayerDiamonds: 0,
        totalHostDiamonds: 0,
      });

      io.emit("streamLeaderboard", []);

      reconnectLock = false;
      return;
    }

    console.log(`🔐 HARD-HOST LOCK: @${HARD_HOST_USERNAME} (${HARD_HOST_ID})`);
    console.log(`🔌 Verbinden met TikTok LIVE… @${HARD_HOST_USERNAME}`);

    const { conn } = await startConnection(
      HARD_HOST_USERNAME,
      () => {
        console.log("⛔ TikTok stream error → reconnect in 3s");
        setTimeout(() => restartTikTokConnection(true), 3000);
      }
    );

    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${HARD_HOST_USERNAME} offline`,
      });

      io.emit("streamStats", {
        totalPlayers: 0,
        totalPlayerDiamonds: 0,
        totalHostDiamonds: 0,
      });

      io.emit("streamLeaderboard", []);

      reconnectLock = false;
      return;
    }

    tiktokConn = conn;

    initGiftEngine(conn);
    initChatEngine(conn);
    await refreshHostUsername();

    startHealthMonitor();
    markTikTokEvent();

    if (currentGameId) {
      await broadcastStats();
      await broadcastRoundLeaderboard();
    } else {
      io.emit("streamStats", {
        totalPlayers: 0,
        totalPlayerDiamonds: 0,
        totalHostDiamonds: 0,
      });

      io.emit("streamLeaderboard", []);
    }

    console.log("✔ TikTok connection fully initialized (HARD LOCK)");
  } catch (err) {
    console.error("TikTok reconnect error:", err);

    emitLog({
      type: "warn",
      message: "TikTok kon niet verbinden.",
    });

    io.emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0,
    });

    io.emit("streamLeaderboard", []);
  }

  reconnectLock = false;
}
// ============================================================================
// ADMIN SOCKET HANDLER
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);

  emitLog({
    type: "system",
    message: "Admin dashboard verbonden",
  });

  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("settings", getArenaSettings());

  socket.emit("host", {
    username: HARD_HOST_USERNAME,
    id: HARD_HOST_ID,
  });

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  // STREAMSTATS INIT
  if (currentGameId) {
    await broadcastStats();
    await broadcastRoundLeaderboard();
  } else {
    socket.emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0,
    });
    socket.emit("streamLeaderboard", []);
  }

  // SNAPSHOT
  socket.on("admin:getInitialSnapshot", async (d, ack) => {
    try {
      const arena = getArena();
      const queueEntries = await getQueue();

      const lbRes = await pool.query(
        `
        SELECT giver_id AS user_id,
               giver_username AS username,
               giver_display_name AS display_name,
               SUM(diamonds) AS total_diamonds
        FROM gifts
        WHERE game_id=$1 AND is_round_gift=TRUE
        GROUP BY giver_id, giver_username, giver_display_name
        ORDER BY total_diamonds DESC
      `,
        [currentGameId ?? null]
      );

      let stats = null;

      if (currentGameId) {
        const res = await pool.query(
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
        const row = res.rows[0] || {};
        stats = {
          totalPlayers: Number(row.total_players || 0),
          totalPlayerDiamonds: Number(row.total_player_diamonds || 0),
          totalHostDiamonds: Number(row.total_host_diamonds || 0),
        };
      } else {
        stats = {
          totalPlayers: 0,
          totalPlayerDiamonds: 0,
          totalHostDiamonds: 0,
        };
      }

      ack({
        arena,
        queue: { open: true, entries: queueEntries },
        logs: logBuffer,
        stats,
        leaderboard: lbRes.rows,
        gameSession: {
          active: currentGameId !== null,
          gameId: currentGameId,
        },
      });
    } catch (err) {
      console.error("snapshot error:", err);
      ack(null);
    }
  });

  // TWIST EVENT INIT (volledig werkend, maar vervangen door nieuwe events)
  initAdminTwistEngine(socket);

  // ========================================================================
  // ADMIN COMMAND HANDLER (VERVANGEN / UITGEBREID)
  // ============================================================================
  async function handle(action: string, data: any, ack: Function) {
    try {
      console.log("[ADMIN ACTION]", action, data);

      // ------------------------------
      // GET SETTINGS
      // ------------------------------
      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID },
          gameActive: currentGameId !== null,
        });
      }

      // ------------------------------
      // SET HOST
      // ------------------------------
      if (action === "setHost") {
        const un = sanitizeHost(data?.username);
        const id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!un || !id) {
          return ack({
            success: false,
            message: "username en tiktok_id verplicht",
          });
        }

        await setSetting("host_username", un);
        await setSetting("host_id", id);

        HARD_HOST_USERNAME = un;
        HARD_HOST_ID = id;

        await refreshHostUsername();

        emitLog({
          type: "system",
          message: `Nieuwe hard-host ingesteld: @${un} (${id})`,
        });

        await restartTikTokConnection(true);

        return ack({ success: true });
      }

      // ------------------------------
      // GAME MANAGEMENT
      // ------------------------------
      if (action === "startGame") {
        await startNewGame();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        await stopCurrentGame();
        return ack({ success: true });
      }

      if (action === "hardResetGame") {
        await hardResetGame();
        return ack({ success: true });
      }

      if (action === "startRound") {
        await startRound("quarter");
        emitArena();
        return ack({ success: true });
      }

      if (action === "endRound") {
        await endRound();
        emitArena();
        return ack({ success: true });
      }

      if (action === "updateSettings") {
        await updateArenaSettings(data);
        socket.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

      // ------------------------------
      // SEARCH USERS — FIXED
      // ------------------------------
      if (action === "searchUsers") {
        const q = (data?.query || "").toString().trim().toLowerCase();
        if (!q || q.length < 2) return ack({ users: [] });

        const like = `%${q}%`;

        const r = await pool.query(
          `
            SELECT tiktok_id, username, display_name
            FROM users
            WHERE LOWER(username) LIKE LOWER($1)
               OR LOWER(display_name) LIKE LOWER($1)
            ORDER BY last_seen_at DESC
            LIMIT 25
          `,
          [like]
        );

        return ack({ users: r.rows });
      }

      // =====================================================================
      // ALLES HIERONDER VEREIST username
      // =====================================================================
      if (!data?.username) {
        return ack({
          success: false,
          message: "username verplicht",
        });
      }

      const queryUser = sanitizeHost(data.username);

      const res = await pool.query(
        `
          SELECT tiktok_id, display_name, username
          FROM users
          WHERE LOWER(username)=LOWER($1)
          LIMIT 1
        `,
        [queryUser]
      );

      if (!res.rows[0]) {
        return ack({
          success: false,
          message: `Gebruiker @${queryUser} niet gevonden`,
        });
      }

      const { tiktok_id, display_name, username } = res.rows[0];

      // =====================================================================
      // USER COMMANDS
      // =====================================================================
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

        // NEW FIX — TWIST EXECUTE
        case "useTwist":
          await useTwist(
            String(tiktok_id),
            display_name,
            data.twist,
            data.target
          );
          return ack({ success: true });

        // NEW FIX — TWIST GIVE
        case "giveTwist":
          await giveTwistToUser(String(tiktok_id), data.twist);
          emitLog({
            type: "twist",
            message: `ADMIN gaf twist '${data.twist}' → ${display_name}`,
          });
          return ack({ success: true });

        default:
          return ack({
            success: false,
            message: `Onbekende actie: ${action}`,
          });
      }

      // After all user mods
      await broadcastRoundLeaderboard();

      return ack({ success: true });
    } catch (err: any) {
      console.error("ADMIN ERROR:", err);
      return ack({
        success: false,
        message: err.message || "Server error",
      });
    }
  }

  // REGISTER EVENTS
  socket.on("admin:getSettings", (d, ack) => handle("getSettings", d, ack));
  socket.on("admin:setHost", (d, ack) => handle("setHost", d, ack));
  socket.on("admin:startGame", (d, ack) => handle("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handle("stopGame", d, ack));
  socket.on("admin:hardResetGame", (d, ack) =>
    handle("hardResetGame", d, ack)
  );
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

  socket.on("admin:promoteUser", (d, ack) => handle("promoteUser", d, ack));
  socket.on("admin:boostUser", (d, ack) => handle("boostUser", d, ack));
  socket.on("admin:demoteUser", (d, ack) => handle("demoteUser", d, ack));

  // TWISTS (NEW)
  socket.on("admin:useTwist", (d, ack) => handle("useTwist", d, ack));
  socket.on("admin:giveTwist", (d, ack) => handle("giveTwist", d, ack));
});

// ============================================================================
// STARTUP FLOW
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();

  // ULTRA RECONNECT ENGINE direct starten
  await restartTikTokConnection(true);
});
