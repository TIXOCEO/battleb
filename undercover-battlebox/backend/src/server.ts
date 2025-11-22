// ============================================================================
// server.ts — Undercover BattleBox — v8.1 HOST PROFILES + CONNECT STATE
// HARD-HOST-LOCK  •  HOST PROFILES DB  •  ULTRA SAFE MODE
// Eén connect attempt → mislukt = idle
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
import { giveTwistToUser } from "./engines/twist-inventory";

// ============================================================================
// ENV + HELPERS
// ============================================================================
dotenv.config();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "supersecret123";

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
// HARD ACTIVE HOST (locked)
// ============================================================================
let HARD_HOST_USERNAME = "";
let HARD_HOST_ID: string | null = null;

// EXPORT VOOR ENGINES
export function getActiveHost() {
  if (!HARD_HOST_ID) return null;
  return {
    id: HARD_HOST_ID,
    username: HARD_HOST_USERNAME,
    display_name: HARD_HOST_USERNAME // simpele fallback zodat engines niet crashen
  };
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
// HOST PROFILES API (HTTP)
// ============================================================================
app.get("/api/hosts", async (req, res) => {
  const r = await pool.query(
    `SELECT id, label, username, tiktok_id, active
     FROM hosts
     ORDER BY id`
  );
  res.json({ success: true, hosts: r.rows });
});

// ============================================================================
// TikTok ID Lookup
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
// QUEUE EMITTER
// ============================================================================
export async function emitQueue() {
  try {
    const q = await getQueue();
    io.emit("updateQueue", { open: true, entries: q });
  } catch (err) {
    console.error("emitQueue error:", err);
  }
}

export { emitArena };

// ============================================================================
// STATS + LEADERBOARD
// ============================================================================
let currentGameId: number | null = null;
(io as any).currentGameId = null;

export async function broadcastRoundLeaderboard() {
  if (!currentGameId) {
    io.emit("streamLeaderboard", []);
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
      AND is_round_gift=TRUE
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
      COALESCE(SUM(CASE WHEN receiver_role='host'
        THEN diamonds ELSE 0 END), 0) AS total_host_diamonds
    FROM gifts
    WHERE game_id=$1
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
// GAME SESSION LOADER
// ============================================================================
async function loadActiveGame() {
  const r = await pool.query(`
    SELECT id FROM games
    WHERE status='running'
    ORDER BY id DESC LIMIT 1
  `);

  currentGameId = r.rows[0]?.id || null;
  (io as any).currentGameId = currentGameId;

  if (currentGameId)
    console.log(`[GAME] Actieve game geladen (#${currentGameId})`);
}

// ============================================================================
// HOST PROFILE LOADER (startup + reconnect)
// ============================================================================
export async function loadActiveHostProfile() {
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

  console.log(
    `🟦 Actieve host geladen → @${HARD_HOST_USERNAME} (${HARD_HOST_ID})`
  );
}

// ============================================================================
// TIKTOK CONNECT ENGINE - ULTRA SAFE MODE
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
  console.log("🔄 TikTok Connect — ULTRA SAFE MODE…");

  await fullyDisconnect();
  await loadActiveHostProfile();

  if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
    emitLog({
      type: "warn",
      message: "Geen actieve host geselecteerd — IDLE mode",
    });
    return;
  }

  console.log(`🔐 HARD-HOST: @${HARD_HOST_USERNAME}`);
  console.log(`🔌 Verbinden met TikTok LIVE…`);

  const { conn } = await startConnection(
    HARD_HOST_USERNAME,
    () => {
      console.log("⚠ Disconnect — blijf in IDLE");
      emitLog({ type: "warn", message: "TikTok disconnect — IDLE mode" });
      fullyDisconnect();
    }
  );

  if (!conn) {
    console.log("❌ Kan geen verbinding maken — host offline");
    emitLog({
      type: "warn",
      message: `Host @${HARD_HOST_USERNAME} offline — IDLE mode`,
    });
    return;
  }

  tiktokConn = conn;
  isConnected = true;
  setLiveState(true);

  io.emit("connectState", {
    connected: true,
    host: {
      username: HARD_HOST_USERNAME,
      id: HARD_HOST_ID,
    },
  });

  initGiftEngine(conn);
  initChatEngine(conn);
  await refreshHostUsername();

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

  console.log("✔ TikTok verbinding actief");
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
// ADMIN SOCKET HANDLER
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  console.log("ADMIN CONNECT:", socket.id);

  // Initial push
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", getArena());
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("settings", getArenaSettings());
  socket.emit("connectState", {
    connected: isConnected,
    host: {
      username: HARD_HOST_USERNAME,
      id: HARD_HOST_ID,
    },
  });

  // Push host list
  const hosts = await pool.query(
    `SELECT id, label, username, tiktok_id, active
     FROM hosts ORDER BY id`
  );
  socket.emit("hosts", hosts.rows);

  // Game state
  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

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

  initAdminTwistEngine(socket);

  // ========================================================================
  // ADMIN ACTION HANDLER
  // ========================================================================
  async function handle(action: string, data: any, ack: Function) {
    try {
      console.log("[ADMIN ACTION]", action, data);

      // --------------------------
      // HOST PROFILES — LIST
      // --------------------------
      if (action === "getHosts") {
        const r = await pool.query(
          `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
        );
        return ack({ success: true, hosts: r.rows });
      }

      // --------------------------
      // CREATE HOST PROFILE
      // --------------------------
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

      // --------------------------
      // DELETE HOST PROFILE
      // --------------------------
      if (action === "deleteHost") {
        const id = data?.id;
        if (!id) return ack({ success: false, message: "id verplicht" });

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

      // --------------------------
      // SET ACTIVE HOST
      // --------------------------
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
          message: `Actieve host gewijzigd → @${HARD_HOST_USERNAME}`,
        });

        await restartTikTokConnection(true);

        io.emit("hostsActiveChanged", {
          username: HARD_HOST_USERNAME,
          tiktok_id: HARD_HOST_ID,
        });

        return ack({ success: true });
      }

      // =====================================================================
      // ORIGINAL GAME MANAGEMENT (ONGEWIJZIGD)
      // =====================================================================

      if (action === "startGame") {
        const r = await pool.query(
          `INSERT INTO games (status) VALUES ('running') RETURNING id`
        );
        currentGameId = r.rows[0].id;
        (io as any).currentGameId = currentGameId;

        emitLog({
          type: "system",
          message: `Nieuw spel gestart (#${currentGameId})`,
        });

        await arenaClear();
        io.emit("gameSession", {
          active: true,
          gameId: currentGameId,
        });

        await broadcastStats();
        await broadcastRoundLeaderboard();
        return ack({ success: true });
      }

      if (action === "stopGame") {
        if (!currentGameId) return ack({ success: true });

        const r = await pool.query(
          `UPDATE games SET status='ended', ended_at=NOW()
           WHERE id=$1 RETURNING ended_at`,
          [currentGameId]
        );

        emitLog({
          type: "system",
          message: `Spel beëindigd (#${currentGameId})`,
        });

        io.emit("gameSession", {
          active: false,
          gameId: currentGameId,
          endedAt: r.rows[0]?.ended_at,
        });

        currentGameId = null;
        (io as any).currentGameId = null;
        await broadcastStats();
        await broadcastRoundLeaderboard();
        return ack({ success: true });
      }

      if (action === "hardResetGame") {
        await pool.query(`
          UPDATE games SET status='ended' WHERE status='running'
        `);
        await pool.query(`DELETE FROM queue`);
        await arenaClear();

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({
          type: "system",
          message: "⚠ HARD RESET uitgevoerd.",
        });

        io.emit("gameSession", { active: false, gameId: null });
        await broadcastStats();
        await broadcastRoundLeaderboard();
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

      // =====================================================================
      // SEARCH USERS
      // =====================================================================
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

      // =====================================================================
      // USER TARGETED ACTIONS (ongewijzigd)
      // =====================================================================
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
        SELECT tiktok_id, display_name, username
        FROM users
        WHERE LOWER(username)=LOWER($1)
        LIMIT 1
      `,
        [qUser]
      );

      if (!rUser.rows.length) {
        rUser = await pool.query(
          `
        SELECT tiktok_id, display_name, username
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

      const { tiktok_id, display_name, username } = rUser.rows[0];

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
          await broadcastRoundLeaderboard();
          return ack({ success: true });

        case "giveTwist":
          await giveTwistToUser(String(tiktok_id), data.twist);
          emitLog({
            type: "twist",
            message: `ADMIN gaf twist '${data.twist}' → ${display_name}`,
          });
          return ack({ success: true });
      }

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
  socket.on("admin:getHosts", (d, ack) => handle("getHosts", d, ack));
  socket.on("admin:createHost", (d, ack) => handle("createHost", d, ack));
  socket.on("admin:deleteHost", (d, ack) => handle("deleteHost", d, ack));
  socket.on("admin:setActiveHost", (d, ack) => handle("setActiveHost", d, ack));

  socket.on("admin:startGame", (d, ack) => handle("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handle("stopGame", d, ack));
  socket.on("admin:hardResetGame", (d, ack) => handle("hardResetGame", d, ack));

  socket.on("admin:startRound", (d, ack) => handle("startRound", d, ack));
  socket.on("admin:endRound", (d, ack) => handle("endRound", d, ack));

  socket.on("admin:updateSettings", (d, ack) => handle("updateSettings", d, ack));

  socket.on("admin:addToArena", (d, ack) => handle("addToArena", d, ack));
  socket.on("admin:addToQueue", (d, ack) => handle("addToQueue", d, ack));
  socket.on("admin:eliminate", (d, ack) => handle("eliminate", d, ack));
  socket.on("admin:removeFromQueue", (d, ack) => handle("removeFromQueue", d, ack));

  socket.on("admin:promoteUser", (d, ack) => handle("promoteUser", d, ack));
  socket.on("admin:boostUser", (d, ack) => handle("boostUser", d, ack));
  socket.on("admin:demoteUser", (d, ack) => handle("demoteUser", d, ack));

  socket.on("admin:useTwist", (d, ack) => handle("useTwist", d, ack));
  socket.on("admin:giveTwist", (d, ack) => handle("giveTwist", d, ack));

  socket.on("admin:searchUsers", (d, ack) => handle("searchUsers", d, ack));
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
  await loadActiveHostProfile();

  await restartTikTokConnection(true);

  console.log("🚀 Server klaar — ULTRA SAFE MODE actief");
});
