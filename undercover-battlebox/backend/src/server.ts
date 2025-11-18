// ============================================================================
// src/server.ts — Undercover BattleBox Engine — v2.7 (FULL, STABLE, HOST-ID)
// ============================================================================
//
// VERBETERINGEN v2.7
//  ✔ Perfecte host-detectie (host_id + host_username)
//  ✔ Geen verkeerde host-match meer
//  ✔ Admin:setHost wist nu host_id automatisch op safe manier
//  ✔ Reconnect flow 100% stabieler
//  ✔ Logs uitgebreid bij user-updates + host resolving
//
// Overige functionaliteit 1-op-1 behouden t.o.v. jouw versie v2.6
//
// ============================================================================

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
import { parseUseCommand, useTwist } from "./engines/8-twist-engine";
import { initAdminTwistEngine } from "./engines/9-admin-twist-engine";
import { getOrUpdateUser } from "./engines/2-user-engine";

dotenv.config();

// ============================================================================
// CONSTANTEN
// ============================================================================
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

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
// LIVE STATE
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

const logBuffer: LogEntry[] = [];
const LOG_MAX = 500;

// LOGGING
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

// QUEUE UPDATE
export async function emitQueue() {
  const entries = await getQueue();
  io.emit("updateQueue", { open: true, entries });
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

  console.log(
    `[STATS] game=${currentGameId} players=${stats.totalPlayers} player💎=${stats.totalPlayerDiamonds} host💎=${stats.totalHostDiamonds}`
  );

  io.emit("streamStats", stats);
}

// ============================================================================
// GAME SESSION HANDLING
// ============================================================================
async function loadActiveGame() {
  const res = await pool.query(
    `
    SELECT id, started_at, ended_at, status FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `
  );

  if (res.rows[0]) {
    currentGameId = res.rows[0].id;
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

  currentGameId = res.rows[0].id;
  (io as any).currentGameId = currentGameId;

  emitLog({ type: "system", message: `Nieuw spel gestart (#${currentGameId})` });

  await arenaClear();
  const payload: GameSession = {
    active: true,
    gameId: currentGameId,
    startedAt: res.rows[0].started_at,
  };
  io.emit("gameSession", payload);

  await broadcastStats();
}

async function stopCurrentGame() {
  if (!currentGameId) return;
  const gameId = currentGameId;

  const res = await pool.query(
    `UPDATE games SET status='ended', ended_at=NOW() WHERE id=$1 RETURNING ended_at`,
    [gameId]
  );

  emitLog({ type: "system", message: `Spel beëindigd (#${gameId})` });
  const payload: GameSession = {
    active: false,
    gameId,
    endedAt: res.rows[0]?.ended_at ?? new Date().toISOString(),
  };
  io.emit("gameSession", payload);

  currentGameId = null;
  (io as any).currentGameId = null;

  await broadcastStats();
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
    return next();
  }
  next(new Error("Unauthorized"));
});

// ============================================================================
// TIKTOK CONNECTION FLOW (improved v2.7)
// ============================================================================
let tiktokConn: any = null;

async function restartTikTokConnection() {
  try {
    if (tiktokConn) {
      try {
        await stopConnection(tiktokConn);
      } catch (err) {
        console.error("❌ Fout bij stopConnection:", err);
      }
      tiktokConn = null;
    }

    const host = await getSetting("host_username");
    if (!host) {
      console.log("⚠ Geen host ingesteld — wacht op nieuwe host");
      return;
    }

    console.log("🔄 TikTok opnieuw verbinden →", host);
    const { conn } = await startConnection(host, () => {});
    if (!conn) {
      emitLog({
        type: "warn",
        message: `Host @${host} offline → Engine in IDLE-modus`,
      });
      return;
    }

    tiktokConn = conn;
    initGiftEngine(conn);
    initChatEngine(conn);

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

        console.log(
          `[TWIST CHAT] ${sender.display_name} (@${sender.username}) → ${text}`
        );

        await parseUseCommand(sender.id, sender.display_name, text);
      } catch (err) {
        console.error("Twist chat handler error:", err);
      }
    });
  } catch (err) {
    console.error("❌ Error during TikTok reconnect", err);
  }
}

// ============================================================================
// ADMIN EVENTS — v2.7 (host_id + host_username veilig)
// ============================================================================

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);
  emitLog({ type: "system", message: "Admin dashboard verbonden" });

  // Initial push
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("settings", getArenaSettings());
  socket.emit("host", await getSetting("host_username"));
  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  // Twist admin engine
  initAdminTwistEngine(socket);

  // SNAPSHOT
  socket.on("admin:getInitialSnapshot", async (_, ack) => {
    const snapshot = {
      arena: getArena(),
      queue: { open: true, entries: await getQueue() },
      logs: logBuffer.slice(0, 200),
      stats: null,
      gameSession: {
        active: currentGameId !== null,
        gameId: currentGameId,
      },
    };
    ack(snapshot);
  });

  // ZOEK FUNCTIE
  socket.on("admin:searchUsers", async ({ query }, ack) => {
    try {
      if (!query || query.length < 2) return ack({ users: [] });

      const q = `%${query.replace("@", "").toLowerCase()}%`;

      const res = await pool.query(
        `SELECT tiktok_id, username, display_name 
         FROM users 
         WHERE LOWER(username) LIKE $1 OR LOWER(display_name) LIKE $1
         ORDER BY username LIMIT 8`,
        [q]
      );

      console.log(
        `[ADMIN SEARCH] "${query}" → ${res.rows.length} resultaten`
      );
      ack({ users: res.rows });
    } catch (err) {
      console.error("admin:searchUsers error:", err);
      ack({ users: [] });
    }
  });

  // ==========================================================================
  // GENERIEKE ADMIN HANDLERS
  // ==========================================================================
  const handle = async (action: string, data: any, ack: Function) => {
    try {
      console.log("[ADMIN ACTION]", action, data);

      // SETTINGS OPHALEN
      if (action === "getSettings") {
        return ack({
          success: true,
          settings: getArenaSettings(),
          host: (await getSetting("host_username")) || "",
          gameActive: currentGameId !== null,
        });
      }

      // ----------------------------------------------------------------------
      // HOST INSTELLEN — v2.7 (extra veilig: host_id wordt geneutraliseerd)
      // ----------------------------------------------------------------------
      if (action === "setHost") {
        if (currentGameId) {
          return ack({
            success: false,
            message: "Host kan niet worden gewijzigd tijdens actief spel",
          });
        }

        const name = data?.username?.trim().replace(/^@/, "") || "";

        // host_username zetten
        await setSetting("host_username", name);

        // host_id wissen → wordt door autodetect opnieuw gezet
        await setSetting("host_id", "");

        emitLog({
          type: "system",
          message: `Nieuwe host ingesteld: @${name} (wacht op autodetect)`,
        });

        await refreshHostUsername();
        io.emit("host", name);

        // opnieuw verbinden
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
        if (!ok) {
          return ack({
            success: false,
            message:
              "Start ronde geweigerd (te weinig spelers, verkeerde status of open eliminaties)",
          });
        }
        return ack({ success: true });
      }

      if (action === "endRound") {
        endRound();
        return ack({ success: true });
      }

      // HANDMATIGE TWIST
      if (action === "triggerTwist") {
        const { twist, target, display_name } = data;
        await useTwist("admin", display_name, twist, target);
        return ack({ success: true });
      }

      // SETTINGS BIJWERKEN
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

      // Vanaf hier acties MET gebruiker
      if (!data?.username)
        return ack({ success: false, message: "username verplicht" });

      const raw = data.username.replace(/^@/, "").trim();
      const userRes = await pool.query(
        `SELECT tiktok_id, display_name, username
         FROM users
         WHERE LOWER(username) = LOWER($1) OR LOWER(username) = LOWER($2)
         LIMIT 1`,
        [raw, `@${raw}`]
      );

      if (!userRes.rows[0]) {
        return ack({
          success: false,
          message: `Gebruiker ${raw} niet gevonden`,
        });
      }

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
            `UPDATE queue SET boost_spots = GREATEST(boost_spots - 1, 0)
             WHERE user_tiktok_id=$1`,
            [tiktok_id]
          );
          await emitQueue();
          emitLog({
            type: "booster",
            message: `${display_name} gedemoveerd (-1)`,
          });
          break;

        default:
          return ack({
            success: false,
            message: `Onbekende actie: ${action}`,
          });
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

  // Socket listeners
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
  socket.on("admin:boostUser", (d, ack) => handle("boostUser", d, ack));
  socket.on("admin:demoteUser", (d, ack) => handle("demoteUser", d, ack));
});

// ============================================================================
// EXPORTS
// ============================================================================
export { emitArena };

// ============================================================================
// STARTUP — v2.7
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  initGame();
  await loadActiveGame();

  // host_username / host_id cache initialiseren
  await initDynamicHost();

  // Saved host ophalen
  const host = await getSetting("host_username");

  if (host) {
    console.log("Connecting TikTok with saved host:", host);

    // Start verbinding
    const { conn } = await startConnection(host, () => {});

    if (!conn) {
      emitLog({
        type: "warn",
        message: `TikTok-host @${host} offline bij startup — Engine in IDLE`,
      });
      return;
    }

    // Opslaan + engines activeren
    tiktokConn = conn;
    initGiftEngine(conn);
    initChatEngine(conn);

  } else {
    console.log("⚠ Geen host ingesteld — wacht op admin:setHost");
  }
});
