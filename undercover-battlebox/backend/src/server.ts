// ============================================================================
// server.ts — Undercover BattleBox — v8.0 HOST PROFILES EDITION
// HARD-HOST-LOCK  •  HOST PROFILES  •  ULTRA-SAFE MODE
// Eén connect attempt, geen auto reconnect
// ============================================================================

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import pool, { getSetting, setSetting } from "./db";
import { initDB } from "./db";

import {
  startConnection,
  stopConnection
} from "./engines/1-connection";

import {
  initGiftEngine,
  refreshHostUsername
} from "./engines/3-gift-engine";

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

// ============================================================================
// STREAM + HARD HOST LOCK
// ============================================================================
let streamLive = false;
export function setLiveState(v: boolean) {
  streamLive = v;
}
export function isStreamLive() {
  return streamLive;
}

let HARD_HOST_ID: string | null = null;
let HARD_HOST_USERNAME = "";

export function getHardHostId() {
  return HARD_HOST_ID;
}
export function getHardHostUsername() {
  return HARD_HOST_USERNAME;
}

// ============================================================================
// ENV + HELPERS
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
// LOGGING ENGINE
// ============================================================================
type LogEntry = { id: string; timestamp: string; type: string; message: string };
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
async function loadActiveHostProfile() {
  const res = await pool.query(
    `SELECT id, username, tiktok_id FROM hosts WHERE active = TRUE LIMIT 1`
  );

  if (!res.rows.length) {
    // fallback: oude settings
    const un = await getSetting("host_username");
    const id = await getSetting("host_id");

    HARD_HOST_USERNAME = un || "";
    HARD_HOST_ID = id || null;
    return;
  }

  HARD_HOST_USERNAME = res.rows[0].username;
  HARD_HOST_ID = String(res.rows[0].tiktok_id);
}

app.get("/api/hosts", async (req, res) => {
  const all = await pool.query(`SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`);
  res.json({ success: true, hosts: all.rows });
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
    const entries = await getQueue();
    io.emit("updateQueue", { open: true, entries });
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
// GAME SESSION MANAGEMENT (ongewijzigd)
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

// ============================================================================
// ADMIN SOCKET + SNAPSHOT
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

  // ► Host profiles naar frontend
  const hosts = await pool.query(
    `SELECT id, label, username, tiktok_id, active FROM hosts ORDER BY id`
  );

  socket.emit("hosts", hosts.rows);

  socket.emit("host", {
    username: HARD_HOST_USERNAME,
    id: HARD_HOST_ID,
  });

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId,
  });

  // Stats
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

  // Snapshot
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
        hosts: hosts.rows,
        activeHost: {
          username: HARD_HOST_USERNAME,
          id: HARD_HOST_ID,
        }
      });
    } catch (err) {
      console.error("snapshot error:", err);
      ack(null);
    }
  });

  initAdminTwistEngine(socket);

});

// ============================================================================
// ADMIN COMMAND HANDLER (met host profiles toegevoegd)
// ============================================================================

io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  async function handle(action: string, data: any, ack: Function) {
    try {
      console.log("[ADMIN ACTION]", action, data);

      // ---------------------------------------------------------------------
      // HOST PROFILES: LIST
      // ---------------------------------------------------------------------
      if (action === "getHosts") {
        const hosts = await pool.query(
          `SELECT id, label, username, tiktok_id, active 
           FROM hosts ORDER BY id`
        );
        return ack({ success: true, hosts: hosts.rows });
      }

      // ---------------------------------------------------------------------
      // HOST PROFILES: CREATE
      // ---------------------------------------------------------------------
      if (action === "createHost") {
        const label = (data?.label || "").trim();
        const username = sanitizeHost(data?.username || "");
        const tiktok_id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!label || !username || !tiktok_id) {
          return ack({
            success: false,
            message: "label, username en tiktok_id verplicht",
          });
        }

        await pool.query(
          `
          INSERT INTO hosts (label, username, tiktok_id, active)
          VALUES ($1, $2, $3, FALSE)
        `,
          [label, username, tiktok_id]
        );

        emitLog({
          type: "system",
          message: `Host-profiel toegevoegd: ${label} (@${username})`,
        });

        return ack({ success: true });
      }

      // ---------------------------------------------------------------------
      // HOST PROFILES: REMOVE
      // ---------------------------------------------------------------------
      if (action === "deleteHost") {
        const id = data?.id;
        if (!id) {
          return ack({ success: false, message: "id verplicht" });
        }

        // voorkom dat actieve host verdwijnt
        const activeCheck = await pool.query(
          `SELECT active FROM hosts WHERE id=$1`,
          [id]
        );

        if (activeCheck.rows[0]?.active) {
          return ack({
            success: false,
            message: "Kan actieve host niet verwijderen",
          });
        }

        await pool.query(`DELETE FROM hosts WHERE id=$1`, [id]);

        emitLog({
          type: "system",
          message: `Host-profiel verwijderd (#${id})`,
        });

        return ack({ success: true });
      }

      // ---------------------------------------------------------------------
      // HOST PROFILES: SET ACTIVE HOST
      // ---------------------------------------------------------------------
      if (action === "setActiveHost") {
        const id = data?.id;
        if (!id) {
          return ack({ success: false, message: "id verplicht" });
        }

        const find = await pool.query(
          `SELECT * FROM hosts WHERE id=$1`,
          [id]
        );

        if (!find.rows.length) {
          return ack({
            success: false,
            message: "Host-profiel niet gevonden",
          });
        }

        // deactivate all
        await pool.query(`UPDATE hosts SET active=FALSE`);

        // activate this one
        await pool.query(
          `UPDATE hosts SET active=TRUE WHERE id=$1`,
          [id]
        );

        HARD_HOST_USERNAME = find.rows[0].username;
        HARD_HOST_ID = String(find.rows[0].tiktok_id);

        emitLog({
          type: "system",
          message: `Actieve host gewijzigd → @${HARD_HOST_USERNAME}`,
        });

        // restart TikTok connection
        await restartTikTokConnection(true);

        return ack({ success: true });
      }

      // ====================================================================================
      // ALLE GAME / ARENA / QUEUE / TWISTS LOGICA IS 100% ONGWIJZIGD BLIJVEN
      // Hier begint je originele switch-case met addToArena, startGame, eliminate etc.
      // ====================================================================================

      // =====================================================================
      // GET SETTINGS
      // =====================================================================
      if (action === "getSettings") {
        const hosts = await pool.query(
          `SELECT id, label, username, tiktok_id, active 
           FROM hosts ORDER BY id`
        );

        return ack({
          success: true,
          settings: getArenaSettings(),
          activeHost: {
            username: HARD_HOST_USERNAME,
            id: HARD_HOST_ID,
          },
          hosts: hosts.rows,
          gameActive: currentGameId !== null,
        });
      }

      // ---------------------------------------------------------------------
      // OUD → setHost (fallback)
      // Blijft bestaan voor backwards compatibility, maar adviseer setActiveHost()
      // ---------------------------------------------------------------------
      if (action === "setHost") {
        const un = sanitizeHost(data?.username);
        const id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!un || !id) {
          return ack({
            success: false,
            message: "username en tiktok_id verplicht",
          });
        }

        HARD_HOST_USERNAME = un;
        HARD_HOST_ID = id;

        await setSetting("host_username", un);
        await setSetting("host_id", id);

        emitLog({
          type: "system",
          message: `Hard-host handmatig ingesteld → @${un}`,
        });

        await restartTikTokConnection(true);

        return ack({ success: true });
      }

      // =====================================================================
      // GAME MANAGEMENT (ongewijzigd)
      // =====================================================================
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

      // =====================================================================
      // SEARCH USERS (ongewijzigd)
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
      // Vanaf dit punt is alles exact jouw originele user-actions switch-case
      // =====================================================================

      if (!data?.username) {
        return ack({
          success: false,
          message: "username verplicht",
        });
      }

      const queryUser = data.username
        .toString()
        .replace("@", "")
        .trim()
        .toLowerCase();

      let res = await pool.query(
        `
          SELECT tiktok_id, display_name, username
          FROM users
          WHERE LOWER(username)=LOWER($1)
          LIMIT 1
        `,
        [queryUser]
      );

      if (!res.rows.length) {
        res = await pool.query(
          `
            SELECT tiktok_id, display_name, username
            FROM users
            WHERE LOWER(username) LIKE LOWER($1)
            ORDER BY last_seen_at DESC NULLS LAST
            LIMIT 1
          `,
          [`%${queryUser}%`]
        );
      }

      if (!res.rows.length) {
        return ack({
          success: false,
          message: `Gebruiker @${queryUser} niet gevonden`,
        });
      }

      const { tiktok_id, display_name, username } = res.rows[0];

      switch (action) {
        case "addToArena":
          arenaJoin(String(tiktok_id), display_name, username);
          await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tiktok_id]);
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
          await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`, [tiktok_id]);
          await emitQueue();
          emitLog({ type: "elim", message: `${display_name} uit queue verwijderd` });
          break;

        case "promoteUser":
        case "boostUser":
          await applyBoost(String(tiktok_id), 1, display_name);
          await emitQueue();
          emitLog({ type: "booster", message: `${display_name} +1 boost` });
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
          emitLog({ type: "booster", message: `${display_name} -1 boost` });
          break;

        case "useTwist":
          await useTwist(String(tiktok_id), display_name, data.twist, data.target);
          await broadcastRoundLeaderboard();
          return ack({ success: true });

        case "giveTwist":
          await giveTwistToUser(String(tiktok_id), data.twist);
          emitLog({ type: "twist", message: `ADMIN gaf twist '${data.twist}' → ${display_name}` });
          return ack({ success: true });

        default:
          return ack({
            success: false,
            message: `Onbekende actie: ${action}`,
          });
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

  // REGISTER ALL EVENTS
  socket.on("admin:getSettings", (d, ack) => handle("getSettings", d, ack));
  socket.on("admin:getHosts", (d, ack) => handle("getHosts", d, ack));
  socket.on("admin:createHost", (d, ack) => handle("createHost", d, ack));
  socket.on("admin:deleteHost", (d, ack) => handle("deleteHost", d, ack));
  socket.on("admin:setActiveHost", (d, ack) => handle("setActiveHost", d, ack));

  socket.on("admin:setHost", (d, ack) => handle("setHost", d, ack)); // backward compat

  socket.on("admin:startGame", (d, ack) => handle("startGame", d, ack));
  socket.on("admin:stopGame", (d, ack) => handle("stopGame", d, ack));
  socket.on("admin:hardResetGame", (d, ack) => handle("hardResetGame", d, ack));

  socket.on("admin:startRound", (d, ack) => handle("startRound", d, ack));
  socket.on("admin:endRound", (d, ack) => handle("endRound", d, ack));

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
// TIKTOK CONNECT ENGINE — ULTRA SAFE MODE (ongewijzigd qua gedrag)
// ============================================================================

let tiktokConn: any = null;

async function fullyDisconnect() {
  try {
    if (tiktokConn) await stopConnection(tiktokConn);
  } catch (e) {
    console.log("⚠ stopConnection fout:", e);
  }
  tiktokConn = null;
  setLiveState(false);
}

export async function restartTikTokConnection(force = false) {
  console.log("🔄 TikTok Connect (ULTRA SAFE MODE)…");

  await fullyDisconnect();

  // laad actieve host uit database
  await loadActiveHostProfile();

  if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
    console.log("❌ GEEN ACTIEVE HOST GESELECTEERD");
    emitLog({
      type: "warn",
      message: "Geen actieve host geselecteerd — Ga naar Admin → Settings → Host Profiles",
    });

    io.emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0,
    });
    io.emit("streamLeaderboard", []);
    return;
  }

  console.log(`🔐 HARD-HOST LOCK: @${HARD_HOST_USERNAME} (${HARD_HOST_ID})`);
  console.log(`🔌 Verbinden met TikTok LIVE… @${HARD_HOST_USERNAME}`);

  const { conn } = await startConnection(
    HARD_HOST_USERNAME,
    () => {
      console.log("⚠ TikTok disconnect — ULTRA SAFE → blij op IDLE");
      emitLog({
        type: "warn",
        message: "TikTok verbinding verbroken — Server staat nu in IDLE.",
      });
      fullyDisconnect();
    }
  );

  if (!conn) {
    console.log("❌ Host offline → IDLE");
    emitLog({
      type: "warn",
      message: `Host @${HARD_HOST_USERNAME} offline — IDLE mode`,
    });
    io.emit("streamLeaderboard", []);
    io.emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0,
    });
    setLiveState(false);
    return;
  }

  tiktokConn = conn;
  setLiveState(true);

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

  console.log("✔ TikTok verbinding actief (ULTRA SAFE MODE)");
          }

// ============================================================================
// ACTIVE HOST LOADER — haalt actieve host op bij startup én bij reconnect
// ============================================================================
export async function loadActiveHostProfile() {
  try {
    const res = await pool.query(
      `
      SELECT username, tiktok_id
      FROM hosts
      WHERE active = TRUE
      LIMIT 1
    `
    );

    if (!res.rows.length) {
      HARD_HOST_USERNAME = "";
      HARD_HOST_ID = null;
      return;
    }

    HARD_HOST_USERNAME = res.rows[0].username;
    HARD_HOST_ID = String(res.rows[0].tiktok_id);

    console.log(
      `🟦 Actieve host geladen → @${HARD_HOST_USERNAME} (${HARD_HOST_ID})`
    );
  } catch (err) {
    console.error("loadActiveHostProfile error:", err);
    HARD_HOST_USERNAME = "";
    HARD_HOST_ID = null;
  }
}

// ============================================================================
// STARTUP FLOW
// ============================================================================
initDB().then(async () => {
  server.listen(4000, () => {
    console.log("BATTLEBOX LIVE → http://0.0.0.0:4000");
  });

  // Game engine init
  initGame();

  // Load active game session
  await loadActiveGame();

  // Load active host profile from DB
  await loadActiveHostProfile();

  // Eerste en enige connect attempt bij opstart
  await restartTikTokConnection(true);

  console.log("🚀 Server klaar — ULTRA SAFE MODE actief");
});
