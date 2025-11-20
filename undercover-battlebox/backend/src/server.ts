// ============================================================================
// server.ts — Undercover BattleBox — v5.1 FIXED
// HARD-HOST-LOCK + TikTok ID Lookup + Exports Fix + Native Fetch
// ============================================================================
//
// ✔ Hard Host Lock (username + id verplicht)
// ✔ Host wordt ALLEEN bepaald door host_id (BigInt match)
// ✔ Geen fallback, geen nickname hijacks
// ✔ Gift/chat engines werken volledig op ID-matching
// ✔ Hard Reset
// ✔ TikTok ID Lookup API
// ✔ Compatible met jouw gewijzigde engines
//
// ★ FIXES:
// ✔ node-fetch verwijderd → native fetch
// ✔ emitQueue toegevoegd + exported
// ✔ emitArena exported
// ✔ Geen ontbrekende exports meer
//
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
import {
  initGiftEngine,
  refreshHostUsername,
} from "./engines/3-gift-engine";
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
// ★ TikTok ID Lookup API (native fetch)
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

  res.json({
    success: true,
    tiktok_id: id,
  });
});


// ============================================================================
// QUEUE EMITTER (FIXED & EXPORTED)
// ============================================================================

async function emitQueue() {
  try {
    const entries = await getQueue();
    io.emit("updateQueue", { open: true, entries });
  } catch (err) {
    console.error("emitQueue error:", err);
  }
}

export { emitQueue };
export { emitArena };  // FIX: exported for engines


// ============================================================================
// STREAM STATS
// ============================================================================

async function broadcastStats() {
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

let currentGameId: number | null = null;
(io as any).currentGameId = null;

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
// RECONNECT ENGINE
// ============================================================================

let tiktokConn: any = null;
let reconnectLock = false;

async function restartTikTokConnection() {
  if (reconnectLock) return;
  reconnectLock = true;

  try {
    if (tiktokConn) {
      try {
        await stopConnection(tiktokConn);
      } catch {}
      tiktokConn = null;
    }

    const hostUser = sanitizeHost(await getSetting("host_username"));
    const hostId = await getSetting("host_id");

    HARD_HOST_USERNAME = hostUser;
    HARD_HOST_ID = hostId ? String(hostId) : null;

    if (!HARD_HOST_ID || !hostUser) {
      console.log("⚠ Hard-Host-Lock: host_id + host_username verplicht.");
      reconnectLock = false;
      return;
    }

    console.log(`🔄 TikTok opnieuw verbinden → @${hostUser} (ID=${HARD_HOST_ID})`);

    const { conn } = await startConnection(hostUser, () => {});

    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${hostUser} offline`,
      });
      reconnectLock = false;
      return;
    }

    tiktokConn = conn;
    initGiftEngine(conn);
    initChatEngine(conn);
    await refreshHostUsername();
  } catch (err) {
    console.error("TikTok reconnect error:", err);
  }

  reconnectLock = false;
}


// ============================================================================
// ADMIN SOCKET HANDLER
// ============================================================================

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);
  emitLog({ type: "system", message: "Admin dashboard verbonden" });

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

  initAdminTwistEngine(socket);

  async function handle(action: string, data: any, ack: Function) {
    try {
      console.log("[ADMIN ACTION]", action, data);

      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID },
          gameActive: currentGameId !== null,
        });
      }

      // SET HOST
      if (action === "setHost") {
        if (currentGameId) {
          return ack({
            success: false,
            message: "Host kan niet worden gewijzigd tijdens actief spel.",
          });
        }

        const cleanUser = sanitizeHost(data?.username || "");
        const cleanId = String(data?.tiktok_id || "");

        if (!cleanUser || !cleanId || !/^\d+$/.test(cleanId)) {
          return ack({
            success: false,
            message: "TikTok username + numerieke ID verplicht",
          });
        }

        await setSetting("host_username", cleanUser);
        await setSetting("host_id", cleanId);

        HARD_HOST_USERNAME = cleanUser;
        HARD_HOST_ID = cleanId;

        io.emit("host", {
          username: cleanUser,
          id: cleanId,
        });

        emitLog({
          type: "system",
          message: `Nieuwe hard-host ingesteld: @${cleanUser} (${cleanId})`,
        });

        await restartTikTokConnection();
        return ack({ success: true });
      }

      // GAME CONTROL ----------------------------------------

      if (action === "startGame") {
        if (currentGameId)
          return ack({
            success: false,
            message: "Er draait al een spel",
          });

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

      if (action === "hardResetGame") {
        await hardResetGame();
        return ack({ success: true });
      }

      if (action === "startRound") {
        const ok = startRound(data?.type || "quarter");
        if (!ok) {
          return ack({
            success: false,
            message: "Start ronde geweigerd",
          });
        }
        return ack({ success: true });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      if (action === "updateSettings") {
        await updateArenaSettings({
          roundDurationPre: Number(data?.roundDurationPre),
          roundDurationFinal: Number(data?.roundDurationFinal),
          graceSeconds: Number(data?.graceSeconds),
          forceEliminations: Boolean(data?.forceEliminations),
        });

        io.emit("settings", getArenaSettings());
        return ack({ success: true });
      }

      // USER actions require username

      if (!data?.username) {
        return ack({
          success: false,
          message: "username verplicht",
        });
      }

      const queryUser = sanitizeHost(data.username);

      const res = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users
         WHERE LOWER(username)=LOWER($1)
         LIMIT 1`,
        [queryUser]
      );

      if (!res.rows[0]) {
        return ack({
          success: false,
          message: `Gebruiker @${queryUser} niet gevonden`,
        });
      }

      const { tiktok_id, display_name, username } = res.rows[0];

      // Arena & queue

      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username);
          await pool.query(
            `DELETE FROM queue WHERE user_tiktok_id=$1`,
            [tiktok_id]
          );
          await emitQueue();
          emitArena();
          emitLog({
            type: "join",
            message: `${display_name} → arena`,
          });
          break;

        case "addToQueue":
          await addToQueue(String(tiktok_id), username);
          await emitQueue();
          emitLog({
            type: "queue",
            message: `${display_name} → queue`,
          });
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

        case "triggerTwist":
          await useTwist("admin", display_name, data.twist, data.target);
          return ack({ success: true });

        default:
          return ack({
            success: false,
            message: `Onbekende actie: ${action}`,
          });
      }

      return ack({ success: true });
    } catch (err: any) {
      console.error("ADMIN ERROR:", err);
      return ack({
        success: false,
        message: err.message || "Server error",
      });
    }
  }

  // REGISTER COMMANDS
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
  socket.on("admin:triggerTwist", (d, ack) =>
    handle("triggerTwist", d, ack)
  );
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

  const confUser = sanitizeHost(await getSetting("host_username"));
  const confId = await getSetting("host_id");

  HARD_HOST_USERNAME = confUser || "";
  HARD_HOST_ID = confId ? String(confId) : null;

  if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
    console.log("❌ GEEN HARD-HOST INGESTELD — wacht op admin:setHost");
    emitLog({
      type: "warn",
      message: "Geen hard-host ingesteld. Ga naar Admin → Settings.",
    });
    return;
  }

  console.log(`🔐 HARD-HOST LOCK: @${HARD_HOST_USERNAME} (${HARD_HOST_ID})`);

  try {
    const { conn } = await startConnection(HARD_HOST_USERNAME, () => {});

    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${HARD_HOST_USERNAME} offline bij startup`,
      });
      return;
    }

    tiktokConn = conn;

    initGiftEngine(conn);
    initChatEngine(conn);

    console.log("✔ TikTok connection fully initialized (HARD LOCK)");
  } catch (err) {
    console.error("TikTok initial connect error:", err);
    emitLog({
      type: "warn",
      message: "TikTok kon niet verbinden bij opstarten.",
    });
  }
});
