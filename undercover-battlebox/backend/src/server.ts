// ============================================================================
// server.ts — BATTLEBOX BACKEND v14.0
// GIFT-ONLY ARCHITECTURE — 100% CONSISTENT SCORES
// ----------------------------------------------------------------------------
// ✔ ALL scores & leaderboards from DB -> gifts table
// ✔ No more mismatches between arena, leaderboard, finale, sender/receiver
// ✔ Host gifts isolated via is_host_gift
// ✔ Full frontend compatibility (total_score, diamonds_total, diamonds_current_round)
// ✔ Arena engine untouched except cosmetic mapping
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
  getArenaSettings,
  startRound,
  endRound
} from "./engines/5-game-engine";

import { getQueue } from "./queue";
import { giveTwistAdmin, useTwistAdmin } from "./engines/9-admin-twist-engine";

interface AdminSocket extends Socket {
  isAdmin?: boolean;
}

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
// EXPRESS + SOCKET.IO
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
// ADMIN AUTH
// ============================================================================
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
// LEADERBOARD: PLAYERS (GIFT-ONLY)
// ============================================================================
export async function broadcastPlayerLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardPlayers", []);
    io.emit("leaderboardPlayersSummary", 0);
    return;
  }

  const hostId = HARD_HOST_ID ? BigInt(HARD_HOST_ID) : null;

  // SUM(diamonds) FROM gifts for each receiver
  const q = await pool.query(
    `
    SELECT 
      g.receiver_id::text AS tiktok_id,
      u.username,
      u.display_name,
      SUM(g.diamonds) FILTER (WHERE g.round_type='round') AS diamonds_current_round,
      SUM(g.diamonds) AS diamonds_total,
      SUM(g.diamonds) AS total_score
    FROM gifts g
    LEFT JOIN users u ON u.tiktok_id = g.receiver_id
    WHERE g.game_id=$1
      AND g.receiver_id IS NOT NULL
      AND g.receiver_id <> $2
    GROUP BY g.receiver_id, u.username, u.display_name
    HAVING SUM(g.diamonds) > 0
    ORDER BY total_score DESC
    LIMIT 200
    `,
    [currentGameId, hostId]
  );

  const summary = q.rows.reduce((acc, r) => acc + Number(r.total_score), 0);

  io.emit("leaderboardPlayers", q.rows);
  io.emit("leaderboardPlayersSummary", summary);
}

// ============================================================================
// LEADERBOARD: GIFTERS (GIFT-ONLY)
// ============================================================================
export async function broadcastGifterLeaderboard() {
  if (!currentGameId) {
    io.emit("leaderboardGifters", []);
    io.emit("leaderboardGiftersSummary", 0);
    return;
  }

  const r = await pool.query(
    `
    SELECT 
      giver_id::text AS user_id,
      giver_username AS username,
      giver_display_name AS display_name,
      SUM(COALESCE(diamonds,0)) AS total_diamonds
    FROM gifts
    WHERE game_id=$1
      AND giver_id IS NOT NULL
    GROUP BY giver_id::text, giver_username, giver_display_name
    ORDER BY total_diamonds DESC
    LIMIT 200
    `,
    [currentGameId]
  );

  const sum = r.rows.reduce((a, b) => a + Number(b.total_diamonds || 0), 0);

  io.emit("leaderboardGifters", r.rows);
  io.emit("leaderboardGiftersSummary", sum);
}

// ============================================================================
// HOST DIAMONDS (GIFT-ONLY)
// ============================================================================
export async function broadcastHostDiamonds() {
  if (!currentGameId || !HARD_HOST_ID) {
    io.emit("hostDiamonds", { username: "", total: 0 });
    return;
  }

  const q = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds),0) AS total
    FROM gifts
    WHERE game_id=$1 AND is_host_gift=TRUE
    `,
    [currentGameId]
  );

  io.emit("hostDiamonds", {
    username: HARD_HOST_USERNAME,
    total: Number(q.rows[0].total || 0)
  });
}

// ============================================================================
// STREAMSTATS (GIFT-ONLY)
// ============================================================================
export async function broadcastStats() {
  if (!currentGameId)
    return io.emit("streamStats", {
      totalPlayers: 0,
      totalPlayerDiamonds: 0,
      totalHostDiamonds: 0
    });

  const r = await pool.query(
    `
    SELECT
      COUNT(DISTINCT receiver_id) AS total_players,
      COALESCE(SUM(diamonds),0) AS total_player_diamonds
    FROM gifts 
    WHERE game_id=$1
    `,
    [currentGameId]
  );

  io.emit("streamStats", {
    totalPlayers: Number(r.rows[0]?.total_players || 0),
    totalPlayerDiamonds: Number(r.rows[0]?.total_player_diamonds || 0),
    totalHostDiamonds: 0
  });
}

// ============================================================================
// CONNECTION MANAGEMENT
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

  io.emit("connectState", {
    connected: true,
    host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID }
  });

  // Engines initialiseren
  initGiftEngine(conn);
  initChatEngine(conn);

  if (currentGameId) {
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();
  }
}

// ============================================================================
// SNAPSHOT BUILDER — GIFT-ONLY
// ============================================================================
async function buildInitialSnapshot() {
  const snap: any = {};

  snap.arena = normalizeArenaForAdmin(getArena());
  snap.queue = { open: true, entries: await getQueue() };
  snap.logs = logBuffer;
  snap.settings = getArenaSettings();

  snap.gameSession = {
    active: currentGameId !== null,
    gameId: currentGameId
  };

  // STREAMSTATS
  if (currentGameId) {
    const r = await pool.query(`
      SELECT COUNT(DISTINCT receiver_id) AS total_players,
             COALESCE(SUM(diamonds),0) AS total_player_diamonds
      FROM gifts WHERE game_id=$1
    `, [currentGameId]);

    snap.stats = r.rows[0] || {};
  } else {
    snap.stats = null;
  }

  // PLAYER LEADERBOARD (GIFT-ONLY)
  if (currentGameId) {
    const hostId = HARD_HOST_ID ? BigInt(HARD_HOST_ID) : null;

    const pl = await pool.query(
      `
      SELECT 
        g.receiver_id::text AS tiktok_id,
        u.username,
        u.display_name,

        SUM(g.diamonds) FILTER (WHERE g.round_type='round') AS diamonds_current_round,
        SUM(g.diamonds) AS diamonds_total,

        SUM(g.diamonds) AS total_score

      FROM gifts g
      LEFT JOIN users u ON u.tiktok_id = g.receiver_id
      WHERE g.game_id=$1
        AND g.receiver_id <> $2
        AND g.receiver_id IS NOT NULL
      GROUP BY g.receiver_id, u.username, u.display_name
      HAVING SUM(g.diamonds) > 0
      ORDER BY total_score DESC
      LIMIT 200
      `,
      [currentGameId, hostId]
    );

    snap.playerLeaderboard = pl.rows;
    snap.playerLeaderboardSummary = pl.rows.reduce(
      (acc,r) => acc + Number(r.total_score),
      0
    );
  } else {
    snap.playerLeaderboard = [];
    snap.playerLeaderboardSummary = 0;
  }

  // GIFTER LEADERBOARD
  if (currentGameId) {
    const gf = await pool.query(
      `
      SELECT 
        giver_id::text AS user_id,
        giver_username AS username,
        giver_display_name AS display_name,
        SUM(COALESCE(diamonds,0)) AS total_diamonds
      FROM gifts
      WHERE game_id=$1
        AND giver_id IS NOT NULL
      GROUP BY giver_id::text, giver_username, giver_display_name
      ORDER BY total_diamonds DESC
      LIMIT 200
      `,
      [currentGameId]
    );

    snap.gifterLeaderboard = gf.rows;
    snap.gifterLeaderboardSummary = gf.rows.reduce(
      (a,b)=>a+Number(b.total_diamonds||0),
      0
    );
  } else {
    snap.gifterLeaderboard = [];
    snap.gifterLeaderboardSummary = 0;
  }

  // HOST DIAMONDS
  if (currentGameId && HARD_HOST_ID) {
    const hx = await pool.query(`
      SELECT COALESCE(SUM(diamonds),0) AS total
      FROM gifts
      WHERE game_id=$1 AND is_host_gift=TRUE
    `, [currentGameId]);

    snap.hostDiamonds = {
      username: HARD_HOST_USERNAME,
      total: Number(hx.rows[0].total || 0)
    };
  } else {
    snap.hostDiamonds = { username: "", total: 0 };
  }

  return snap;
}

// ============================================================================
// ARENA NORMALIZER (voegt UI-verwachte velden toe)
// ============================================================================
function normalizeArenaForAdmin(arena: any) {
  if (!arena || !Array.isArray(arena.players)) return arena;

  return {
    ...arena,
    players: arena.players.map((p: any) => ({
      ...p,
      diamonds_current_round: p.diamonds ?? 0,
      diamonds_total: 0,          // Arena toont dit niet — leaderboard bepaalt
      total_score: p.diamonds ?? 0
    }))
  };
}

// ============================================================================
// SOCKET HANDLER
// ============================================================================
io.on("connection", async (socket: AdminSocket) => {
  if (!socket.isAdmin) return socket.disconnect();

  // Direct init
  socket.emit("initialLogs", logBuffer);
  socket.emit("updateArena", normalizeArenaForAdmin(getArena()));
  socket.emit("updateQueue", { open: true, entries: await getQueue() });
  socket.emit("settings", getArenaSettings());

  socket.emit("connectState", {
    connected: isStreamLive(),
    host: { username: HARD_HOST_USERNAME, id: HARD_HOST_ID }
  });

  const hosts = await pool.query(`
    SELECT id, label, username, tiktok_id, active
    FROM hosts ORDER BY id
  `);
  socket.emit("hosts", hosts.rows);

  socket.emit("gameSession", {
    active: currentGameId !== null,
    gameId: currentGameId
  });

  if (currentGameId) {
    await broadcastPlayerLeaderboard();
    await broadcastGifterLeaderboard();
    await broadcastHostDiamonds();
  }

  socket.on("getInitialSnapshot", async (_p, ack) => {
    const snap = await buildInitialSnapshot();
    ack(snap);
  });

  // ============================================================================
  // UNIVERSAL ADMIN HANDLER
  // ============================================================================
  async function handle(action: string, data: any, ack: Function) {
    try {
      // ------------------------------------------------------
      // HOST MANAGEMENT
      // ------------------------------------------------------
      if (action === "getHosts") {
        const r = await pool.query(`
          SELECT id, label, username, tiktok_id, active
          FROM hosts ORDER BY id
        `);
        return ack({ success: true, hosts: r.rows });
      }

      if (action === "createHost") {
        const label = (data?.label || "").trim();
        const un = (data?.username || "").trim().replace(/^@+/,"").toLowerCase();
        const id = data?.tiktok_id ? String(data.tiktok_id) : null;

        if (!label || !un || !id)
          return ack({ success:false, message:"label, username en tiktok_id verplicht" });

        await pool.query(`
          INSERT INTO hosts (label, username, tiktok_id, active)
          VALUES ($1,$2,$3,FALSE)
        `,[label,un,id]);

        emitLog({ type:"system", message:`Host toegevoegd: ${label} (@${un})`});
        return ack({ success:true });
      }

      if (action === "deleteHost") {
        const id = data?.id;
        if (!id) return ack({ success:false, message:"id verplicht" });

        const check = await pool.query(`SELECT active FROM hosts WHERE id=$1`,[id]);
        if (check.rows[0]?.active)
          return ack({ success:false, message:"Kan actieve host niet verwijderen" });

        await pool.query(`DELETE FROM hosts WHERE id=$1`,[id]);
        emitLog({ type:"system", message:`Host verwijderd (#${id})`});
        return ack({ success:true });
      }

      if (action === "setActiveHost") {
        const id = data?.id;
        if (!id) return ack({ success:false, message:"id verplicht" });

        const find = await pool.query(`SELECT * FROM hosts WHERE id=$1`,[id]);
        if (!find.rows.length)
          return ack({ success:false, message:"Host niet gevonden" });

        await pool.query(`UPDATE hosts SET active=FALSE`);
        await pool.query(`UPDATE hosts SET active=TRUE WHERE id=$1`,[id]);

        HARD_HOST_USERNAME = find.rows[0].username;
        HARD_HOST_ID = String(find.rows[0].tiktok_id);

        emitLog({ type:"system", message:`Actieve host is nu @${HARD_HOST_USERNAME}`});

        await restartTikTokConnection();

        io.emit("hostsActiveChanged", {
          username:HARD_HOST_USERNAME,
          tiktok_id:HARD_HOST_ID
        });

        return ack({ success:true });
      }

      // ------------------------------------------------------
      // GAME MANAGEMENT
      // ------------------------------------------------------
      if (action === "startGame") {
        const r = await pool.query(`
          INSERT INTO games (status)
          VALUES ('running')
          RETURNING id
        `);

        currentGameId = r.rows[0].id;
        (io as any).currentGameId = currentGameId;

        await pool.query(`TRUNCATE gifts`);
        await arenaClear();

        emitLog({ type:"system", message:`Nieuw spel gestart (#${currentGameId})` });

        io.emit("gameSession", {
          active:true,
          gameId:currentGameId
        });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();

      return ack({ success:true });
      }

      if (action === "stopGame") {
        if (!currentGameId)
          return ack({ success:true });

        await pool.query(`
          UPDATE games
          SET status='ended', ended_at=NOW()
          WHERE id=$1
        `,[currentGameId]);

        await pool.query(`TRUNCATE gifts`);
        await arenaClear();

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({ type:"system", message:"Spel beëindigd" });

        io.emit("gameSession", { active:false, gameId:null });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();

        return ack({ success:true });
      }

      if (action === "hardResetGame") {
        await pool.query(`UPDATE games SET status='ended' WHERE status='running'`);
        await pool.query(`DELETE FROM queue`);
        await pool.query(`TRUNCATE gifts`);
        await arenaClear();

        currentGameId = null;
        (io as any).currentGameId = null;

        emitLog({ type:"system", message:"⚠ HARD RESET uitgevoerd" });

        io.emit("gameSession", { active:false, gameId:null });

        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();

        return ack({ success:true });
      }

      // ------------------------------------------------------
      // ROUND MANAGEMENT
      // ------------------------------------------------------
      if (action === "startRound") {
        const type = data?.type === "finale" ? "finale" : "quarter";

        const ok = startRound(type);
        if (!ok)
          return ack({ success:false, message:"Ronde kon niet gestart worden" });

        emitArena();
        await broadcastPlayerLeaderboard();

        return ack({ success:true });
      }

      if (action === "endRound") {
        await endRound();

        emitArena();
        await broadcastPlayerLeaderboard();
        await broadcastGifterLeaderboard();
        await broadcastHostDiamonds();

        return ack({ success:true });
      }

      // ------------------------------------------------------
      // ARENA MANAGEMENT
      // ------------------------------------------------------
      if (action === "addToArena") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();

        const r = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!r.rows.length)
          return ack({ success:false, message:"User niet gevonden" });

        if (String(r.rows[0].tiktok_id) === HARD_HOST_ID)
          return ack({ success:false, message:"Host kan niet in de arena staan" });

        await arenaJoin(
          String(r.rows[0].tiktok_id),
          r.rows[0].display_name,
          r.rows[0].username
        );

        emitArena();
        emitLog({ type:"arena", message:`${r.rows[0].display_name} toegevoegd aan arena` });

        return ack({ success:true });
      }

      if (action === "eliminate") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();

        const r = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!r.rows.length)
          return ack({ success:false, message:"User niet gevonden" });

        if (String(r.rows[0].tiktok_id) === HARD_HOST_ID)
          return ack({ success:false, message:"Host kan niet geëlimineerd worden" });

        await arenaLeave(String(r.rows[0].tiktok_id));

        emitArena();
        emitLog({ type:"elim", message:`${r.rows[0].display_name} geëlimineerd` });

        return ack({ success:true });
      }

      // ------------------------------------------------------
      // SEARCH / QUEUE
      // ------------------------------------------------------
      if (action === "searchUsers") {
        const q = (data?.query||"").trim().toLowerCase();
        if (!q || q.length < 2) return ack({ users:[] });

        const like = `%${q}%`;

        const r = await pool.query(`
          SELECT tiktok_id, username, display_name
          FROM users
          WHERE LOWER(username) LIKE LOWER($1)
             OR LOWER(display_name) LIKE LOWER($1)
          ORDER BY last_seen_at DESC NULLS LAST
          LIMIT 25
        `,[like]);

        return ack({ users:r.rows });
      }

      if (action === "addToQueue") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();
        if (!clean)
          return ack({ success:false, message:"Geen username opgegeven" });

        const u = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!u.rows.length)
          return ack({ success:false, message:`User @${clean} niet gevonden` });

        if (String(u.rows[0].tiktok_id) === HARD_HOST_ID)
          return ack({ success:false, message:"Host kan niet in queue staan" });

        await pool.query(`
          INSERT INTO queue (user_tiktok_id, boost_spots, joined_at)
          VALUES ($1,0,NOW())
          ON CONFLICT (user_tiktok_id) DO NOTHING
        `,[u.rows[0].tiktok_id]);

        emitLog({ type:"queue", message:`${u.rows[0].display_name} → queue` });

        io.emit("updateQueue", {
          open:true,
          entries: await getQueue()
        });

        return ack({ success:true });
      }

      if (action === "removeFromQueue") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();

        const u = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!u.rows.length)
          return ack({ success:false, message:"User niet gevonden" });

        await pool.query(`DELETE FROM queue WHERE user_tiktok_id=$1`,[
          u.rows[0].tiktok_id
        ]);

        emitLog({ type:"queue", message:`${u.rows[0].display_name} uit queue verwijderd` });

        io.emit("updateQueue", {
          open:true,
          entries: await getQueue()
        });

        return ack({ success:true });
      }

      // ------------------------------------------------------
      // VIP / FAN
      // ------------------------------------------------------
      if (action === "giveVip") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();

        const r = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!r.rows.length)
          return ack({ success:false, message:"User niet gevonden" });

        await pool.query(`
          UPDATE users
          SET is_vip=TRUE,
              vip_expires_at = NOW() + interval '30 days'
          WHERE tiktok_id=$1
        `,[r.rows[0].tiktok_id]);

        emitLog({ type:"vip", message:`${r.rows[0].display_name} kreeg VIP` });
        return ack({ success:true });
      }

      if (action === "removeVip") {
        const clean = (data?.username||"").trim().replace(/^@+/,"").toLowerCase();

        const r = await pool.query(`
          SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1
        `,[clean]);

        if (!r.rows.length)
          return ack({ success:false, message:"User niet gevonden" });

        await pool.query(`
          UPDATE users
          SET is_vip=FALSE,
              vip_expires_at=NULL
          WHERE tiktok_id=$1
        `,[r.rows[0].tiktok_id]);

        emitLog({ type:"vip", message:`${r.rows[0].display_name} VIP verwijderd` });
        return ack({ success:true });
      }

      // ------------------------------------------------------
      // TWISTS
      // ------------------------------------------------------
      if (action === "giveTwist") {
        await giveTwistAdmin(data.username, data.twist);
        return ack({ success:true });
      }

      if (action === "useTwist") {
        await useTwistAdmin(data.username, data.twist, data.target||"");
        emitArena();
        return ack({ success:true });
      }

      // ------------------------------------------------------
      // ONBEKEND
      // ------------------------------------------------------
      return ack({ success:false, message:"Onbekend admin commando" });

    } catch (err:any) {
      console.error("Admin error:", err);
      return ack({
        success:false,
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
server.listen(PORT, () => {
  console.log(`🚀 Backend live op poort ${PORT}`);
});
