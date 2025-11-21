// ============================================================================
// TikTok ID Lookup API (unchanged)
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
// STREAM STATS + ROUND LEADERBOARD  (unchanged)
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
// RECONNECT ENGINE — PROXY PATCHED
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
    console.log("🔄 RECONNECT ENGINE (proxy): start…");

    await fullyDisconnect();

    const confUser = sanitizeHost(await getSetting("host_username"));
    const confId = await getSetting("host_id");

    HARD_HOST_USERNAME = confUser || "";
    HARD_HOST_ID = confId ? String(confId) : null;

    if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
      console.log("❌ GEEN HARD-HOST INGESTELD");
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
    console.log(`🔌 Verbinden (PROXY)… @${HARD_HOST_USERNAME}`);

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

    // PROXY CONNECTION SUPPORT
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

    console.log("✔ TikTok connection fully initialized (PROXY MODE)");
  } catch (err) {
    console.error("TikTok reconnect error:", err);

    emitLog({
      type: "warn",
      message: "TikTok kon niet verbinden (proxy).",
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
// ADMIN SOCKET HANDLER (unchanged)
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

  initAdminTwistEngine(socket);

  // ADMIN COMMANDS (unchanged)
  function ackSuccess(ack: Function) {
    ack({ success: true });
  }

  socket.on("admin:getSettings", (d, ack) =>
    handle("getSettings", d, ack)
  );
  socket.on("admin:setHost", (d, ack) =>
    handle("setHost", d, ack)
  );
  socket.on("admin:startGame", (d, ack) =>
    handle("startGame", d, ack)
  );
  socket.on("admin:stopGame", (d, ack) =>
    handle("stopGame", d, ack)
  );
  socket.on("admin:hardResetGame", (d, ack) =>
    handle("hardResetGame", d, ack)
  );
  socket.on("admin:startRound", (d, ack) =>
    handle("startRound", d, ack)
  );
  socket.on("admin:endRound", (d, ack) =>
    handle("endRound", d, ack)
  );
  socket.on("admin:updateSettings", (d, ack) =>
    handle("updateSettings", d, ack)
  );

  socket.on("admin:addToArena", (d, ack) =>
    handle("addToArena", d, ack)
  );
  socket.on("admin:addToQueue", (d, ack) =>
    handle("addToQueue", d, ack)
  );
  socket.on("admin:eliminate", (d, ack) =>
    handle("eliminate", d, ack)
  );
  socket.on("admin:removeFromQueue", (d, ack) =>
    handle("removeFromQueue", d, ack)
  );
  socket.on("admin:promoteUser", (d, ack) =>
    handle("promoteUser", d, ack)
  );
  socket.on("admin:boostUser", (d, ack) =>
    handle("boostUser", d, ack)
  );
  socket.on("admin:demoteUser", (d, ack) =>
    handle("demoteUser", d, ack)
  );

  socket.on("admin:useTwist", (d, ack) =>
    handle("useTwist", d, ack)
  );
  socket.on("admin:giveTwist", (d, ack) =>
    handle("giveTwist", d, ack)
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

  await restartTikTokConnection(true);
});

// ============================================================================
// TikTok ID Lookup API (unchanged)
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
// STREAM STATS + ROUND LEADERBOARD  (unchanged)
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
// GAME SESSION MANAGEMENT (unchanged)
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
// HARD RESET — unchanged
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
// ADMIN SOCKET AUTH — unchanged
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
// ULTRA PROXY RECONNECT ENGINE v3.2  (MINIMALE PATCHES!)
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
    console.log("🔄 RECONNECT ENGINE (proxy): start…");

    await fullyDisconnect();

    const confUser = sanitizeHost(await getSetting("host_username"));
    const confId = await getSetting("host_id");

    HARD_HOST_USERNAME = confUser || "";
    HARD_HOST_ID = confId ? String(confId) : null;

    if (!HARD_HOST_USERNAME || !HARD_HOST_ID) {
      console.log("❌ GEEN HARD-HOST INGESTELD");
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
    console.log(`🔌 Verbinden (PROXY)… @${HARD_HOST_USERNAME}`);

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

    // PROXY connection injects events itself
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

    console.log("✔ TikTok connection fully initialized (PROXY MODE)");
  } catch (err) {
    console.error("TikTok reconnect error:", err);

    emitLog({
      type: "warn",
      message: "TikTok kon niet verbinden (proxy).",
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
// ADMIN SOCKET HANDLER (unchanged logic)
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
            COALESCE(SUM(CASE WHEN receiver_role = 'host')
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

  initAdminTwistEngine(socket);

  // ADMIN COMMANDS registratie — unchanged
  socket.on("admin:getSettings", (d, ack) =>
    handle("getSettings", d, ack)
  );
  socket.on("admin:setHost", (d, ack) =>
    handle("setHost", d, ack)
  );
  socket.on("admin:startGame", (d, ack) =>
    handle("startGame", d, ack)
  );
  socket.on("admin:stopGame", (d, ack) =>
    handle("stopGame", d, ack)
  );
  socket.on("admin:hardResetGame", (d, ack) =>
    handle("hardResetGame", d, ack)
  );
  socket.on("admin:startRound", (d, ack) =>
    handle("startRound", d, ack)
  );
  socket.on("admin:endRound", (d, ack) =>
    handle("endRound", d, ack)
  );
  socket.on("admin:updateSettings", (d, ack) =>
    handle("updateSettings", d, ack)
  );

  socket.on("admin:addToArena", (d, ack) =>
    handle("addToArena", d, ack)
  );
  socket.on("admin:addToQueue", (d, ack) =>
    handle("addToQueue", d, ack)
  );
  socket.on("admin:eliminate", (d, ack) =>
    handle("eliminate", d, ack)
  );
  socket.on("admin:removeFromQueue", (d, ack) =>
    handle("removeFromQueue", d, ack)
  );

  socket.on("admin:promoteUser", (d, ack) =>
    handle("promoteUser", d, ack)
  );
  socket.on("admin:boostUser", (d, ack) =>
    handle("boostUser", d, ack)
  );
  socket.on("admin:demoteUser", (d, ack) =>
    handle("demoteUser", d, ack)
  );

  socket.on("admin:useTwist", (d, ack) =>
    handle("useTwist", d, ack)
  );
  socket.on("admin:giveTwist", (d, ack) =>
    handle("giveTwist", d, ack)
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

  await restartTikTokConnection(true);
});
