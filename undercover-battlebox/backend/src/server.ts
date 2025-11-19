// ============================================================================
// server.ts — Undercover BattleBox — v3.6 (HOST-SAFE + GIFTENGINE v6.2 READY)
// ============================================================================
//
// BELANGRIJKSTE VERBETERINGEN:
// --------------------------------------------------------------
// ✔ Volledige integratie met GiftEngine v6.2 (host without anchorId)
// ✔ Host sanitize + reset host_id bij wijziging
// ✔ Ultra-stabiele reconnect — geen loops, geen spam
// ✔ queue / arena / twist events sneller & veiliger
// ✔ Fix: io export correct (server blijft stabiel)
// ✔ Fix: startup connect-flow gegarandeerd non-blocking
// ✔ Fix: startRound / endRound in parallel met GiftEngine stabiel
// ✔ Uncatchable TikTok connect errors keurig afgevangen
// ✔ Geen memory leaks bij verkeerde onAny listeners
// ✔ Log-systeem veel stabieler
//
// GAMEPLAY LOGICA:
///        ⭐ 100% ongewijzigd ⭐
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

import pool, { getSetting, setSetting } from "./db";
import { initDB } from "./db";

// ---- Engines ---------------------------------------------------------------
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
import { useTwist } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { getOrUpdateUser } from "./engines/2-user-engine";

dotenv.config();

// ============================================================================
// CONSTANTEN
// ============================================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

// TikTok username sanitizer
function sanitizeHost(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
}

// EXPRESS SERVER
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

// ============================================================================
// SOCKET.IO SERVER
// ============================================================================
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

type GameSession = {
  active: boolean;
  gameId: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

let tiktokConn: any = null;
let reconnectLock = false;

const logBuffer: LogEntry[] = [];
const LOG_MAX = 500;

// ============================================================================
// LOGGING
// ============================================================================
export function emitLog(entry: Partial<LogEntry>) {
  const log: LogEntry = {
    id: entry.id ?? Date.now().toString(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
    type: entry.type ?? "system",
    message: entry.message ?? "",
  };

  logBuffer.unshift(log);
  if (logBuffer.length > LOG_MAX) logBuffer.pop();

  try {
    io.emit("log", log);
  } catch {}
}

// ============================================================================
// QUEUE UPDATE
// ============================================================================
export async function emitQueue() {
  try {
    const entries = await getQueue();
    io.emit("updateQueue", { open: true, entries });
  } catch (err) {
    console.error("emitQueue error:", err);
  }
}

// ============================================================================
// STREAM STATS
// ============================================================================
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
  const stats: StreamStats = {
    totalPlayers: Number(row.total_players || 0),
    totalPlayerDiamonds: Number(row.total_player_diamonds || 0),
    totalHostDiamonds: Number(row.total_host_diamonds || 0),
  };

  io.emit("streamStats", stats);
}

// ============================================================================
// GAME SESSION MANAGEMENT
// ============================================================================
async function loadActiveGame() {
  const res = await pool.query(
    `SELECT id, started_at, ended_at FROM games
     WHERE status='running'
     ORDER BY id DESC LIMIT 1`
  );

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
    `INSERT INTO games (status) VALUES ('running')
     RETURNING id, started_at`
  );

  currentGameId = res.rows[0].id;
  (io as any).currentGameId = currentGameId;

  emitLog({ type: "system", message: `Nieuw spel gestart (#${currentGameId})` });

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
    `UPDATE games SET status='ended', ended_at=NOW()
     WHERE id=$1 RETURNING ended_at`,
    [currentGameId]
  );

  emitLog({ type: "system", message: `Spel beëindigd (#${currentGameId})` });

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
// STABIELE TIKTOK RECONNECT
// ============================================================================
async function restartTikTokConnection() {
  if (reconnectLock) return;
  reconnectLock = true;

  try {
    // force close previous connection
    if (tiktokConn) {
      try {
        await stopConnection(tiktokConn);
      } catch {}
      tiktokConn = null;
    }

    const host = sanitizeHost((await getSetting("host_username")) || "");

    if (!host) {
      reconnectLock = false;
      console.log("⚠ Geen host ingesteld.");
      return;
    }

    console.log("🔄 TikTok opnieuw verbinden →", host);

    const { conn } = await startConnection(host, () => {});
    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${host} offline`,
      });
      reconnectLock = false;
      return;
    }

    tiktokConn = conn;

    // Re-init engines
    initGiftEngine(conn);
    initChatEngine(conn);

  } catch (err) {
    console.error("TikTok reconnect error:", err);
  }

  reconnectLock = false;
}

// ============================================================================
// ADMIN SOCKET HANDLER — START
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);

  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  // push initial state
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", {
    open: true,
    entries: await getQueue(),
  });
  socket.emit("settings", getArenaSettings());

  const savedHost = sanitizeHost((await getSetting("host_username")) || "");
  socket.emit("host", savedHost);

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  initAdminTwistEngine(socket);

  // REGISTER ACTION HANDLER
  const handle = async (action: string, data: any, ack: Function) => {
    try {
      console.log("[ADMIN ACTION]", action, data);

    // ==========================================
      // BASIS-INFORMATIE
      // ==========================================
      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: sanitizeHost((await getSetting("host_username")) || ""),
          gameActive: currentGameId !== null,
        });
      }

      // ==========================================
      // HOST WIJZIGEN (veilig, synchronised)
      // ==========================================
      if (action === "setHost") {
        if (currentGameId) {
          return ack({
            success: false,
            message: "Host kan niet worden gewijzigd tijdens actief spel.",
          });
        }

        const raw = data?.username || "";
        const clean = sanitizeHost(raw);

        if (!clean) {
          return ack({
            success: false,
            message: "Ongeldige TikTok gebruikersnaam",
          });
        }

        // Opslaan + host_id resetten
        await setSetting("host_username", clean);
        await setSetting("host_id", "");

        emitLog({
          type: "system",
          message: `Nieuwe host ingesteld: @${clean} (auto-detect opnieuw uitgevoerd)`,
        });

        await refreshHostUsername();
        io.emit("host", clean);

        await restartTikTokConnection();
        return ack({ success: true });
      }

      // ==========================================
      // GAME START/STOP
      // ==========================================
      if (action === "startGame") {
        if (currentGameId)
          return ack({ success: false, message: "Er draait al een spel." });

        await startNewGame();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId)
          return ack({ success: false, message: "Geen actief spel." });

        await stopCurrentGame();
        return ack({ success: true });
      }

      // ==========================================
      // RONDES
      // ==========================================
      if (action === "startRound") {
        const ok = startRound(data?.type || "quarter");

        if (!ok) {
          return ack({
            success: false,
            message:
              "Start ronde geweigerd (status onjuist, te weinig spelers of open eliminaties).",
          });
        }

        return ack({ success: true });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      // ==========================================
      // ARENA SETTINGS
      // ==========================================
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

      // ==========================================
      // USER ACTIONS (ARENA / QUEUE / BOOST)
      // ==========================================
      if (!data?.username) {
        return ack({
          success: false,
          message: "username is verplicht.",
        });
      }

      const queryUser = sanitizeHost(data.username);

      const res = await pool.query(
        `
          SELECT tiktok_id, display_name, username
          FROM users
          WHERE LOWER(username)=LOWER($1)
             OR LOWER(username)=LOWER($2)
          LIMIT 1
        `,
        [queryUser, `@${queryUser}`]
      );

      if (!res.rows[0]) {
        return ack({
          success: false,
          message: `Gebruiker @${queryUser} niet gevonden.`,
        });
      }

      const { tiktok_id, display_name, username } = res.rows[0];

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
        case "boostUser":
          await applyBoost(String(tiktok_id), 1, display_name);
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} gepromoveerd (+1)`,
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
            message: `${display_name} gedemoveerd (-1)`,
          });
          break;

        // ==========================================
        // TWIST TRIGGER (ADMIN MANUAL)
        // ==========================================
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
  };

  // ==========================================
  // REGISTER ALL ADMIN SOCKET EVENTS
  // ==========================================
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

  // load arena settings + push state
  initGame();
  await loadActiveGame();

  // load cached host from DB
  await initDynamicHost();

  const host = sanitizeHost((await getSetting("host_username")) || "");

  if (!host) {
    console.log("⚠ Geen host ingesteld — wacht op admin:setHost");
    return;
  }

  console.log("Initial TikTok connect →", host);

  try {
    const { conn } = await startConnection(host, () => {});
    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${host} offline bij startup — Engine in idle.`,
      });
      return;
    }

    tiktokConn = conn;
    initGiftEngine(conn);
    initChatEngine(conn);

  } catch (err) {
    console.error("TikTok initial connect error:", err);
    emitLog({
      type: "warn",
      message: `TikTok kon niet verbinden bij opstarten.`,
    });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================
export { emitArena };
