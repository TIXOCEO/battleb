/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v15
   VARIANT 1 — "Admin starts finale manually"
   -------------------------------------------
   ✔ Danger: pos 6–8 ONLY during round
   ✔ Eliminations ONLY after round (on GRACE → ENDED)
   ✔ Idle: everyone alive (immune stays immune)
   ✔ New players NEVER get elimination/danger on join
   ✔ Round durations come from DATABASE (table: arena_settings)
   ✔ Finals auto-track first final round index
   ✔ Arena scoring always uses gifts.game_id filtering
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;               // TikTok ID
  username: string;
  display_name: string;
  score: number;

  boosters: string[];       // "immune", "shield", etc.
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
  eliminated?: boolean;
}

export interface ArenaSettings {
  roundDurationPre: number;     // loaded from DB
  roundDurationFinal: number;   // loaded from DB
  graceSeconds: number;         // loaded from DB
  forceEliminations: boolean;   // loaded from DB
}

export interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: RoundType;              // quarter | finale
  status: ArenaStatus;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;

  firstFinalRound: number | null;   // IMPORTANT FOR TOTAL SCORE CALC
  lastSortedAt: number;
}

/* ============================================================================
   MEMORY (initial state)
============================================================================ */

let arena: ArenaState = {
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",

  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,

  settings: {
    roundDurationPre: 300,     // default 5 min, will be overwritten by DB
    roundDurationFinal: 180,   // default 3 min, will be overwritten by DB
    graceSeconds: 10,
    forceEliminations: true,
  },

  firstFinalRound: null,
  lastSortedAt: 0,
};

/* ============================================================================
   LOAD SETTINGS FROM DATABASE
============================================================================ */

export async function loadArenaSettingsFromDB() {
  const r = await pool.query(`
    SELECT key, value
    FROM arena_settings
  `);

  if (!r.rows.length) {
    console.log("⚠ Geen arena_settings gevonden — defaults blijven actief.");
    return;
  }

  for (const row of r.rows) {
    const key = row.key;
    const value = Number(row.value);

    if (key === "roundDurationPre") arena.settings.roundDurationPre = value;
    if (key === "roundDurationFinal") arena.settings.roundDurationFinal = value;
    if (key === "graceSeconds") arena.settings.graceSeconds = value;
    if (key === "forceEliminations") arena.settings.forceEliminations = value === 1;
  }

  console.log("✔ Arena settings geladen uit database:", arena.settings);
}

/* ============================================================================
   GETTERS
============================================================================ */

export function getArena(): ArenaState {
  return arena;
}

export function getArenaSettings(): ArenaSettings {
  return arena.settings;
}

/* ============================================================================
   SCORE FETCHER — Diamonds ONLY for current game_id
============================================================================ */

async function getPlayerScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
    `,
    [BigInt(tiktokId), gid]
  );

  return Number(q.rows[0]?.score || 0);
}

/* ============================================================================
   POSITION COMPUTATION (YOUR EXACT RULES)
============================================================================ */

async function recomputePositions() {
  const status = arena.status;

  // Update all scores first
  for (const p of arena.players) {
    p.score = await getPlayerScore(p.id);
  }

  // Sort by score DESC
  arena.players.sort((a, b) => b.score - a.score);

  const total = arena.players.length;

  /* -------------------------------------------------------------
     IDLE — no danger, no elimination
  ------------------------------------------------------------- */
  if (status === "idle") {
    for (const p of arena.players) {
      if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
      } else {
        p.positionStatus = "alive";
      }
      p.eliminated = false;
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* -------------------------------------------------------------
     ACTIVE + GRACE — danger zone (6–8) ONLY
     No eliminations yet!
  ------------------------------------------------------------- */
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    // Immune = override everything
    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      p.eliminated = false;
      continue;
    }

    if (total < 6) {
      // Under 6 players → everyone safe
      p.positionStatus = "alive";
      p.eliminated = false;
      continue;
    }

    if (i <= 4) {
      p.positionStatus = "alive";
      p.eliminated = false;
      continue;
    }

    // pos 6–8 (index 5–7) → danger
    if (i >= 5 && i <= 7) {
      p.positionStatus = "danger";
      p.eliminated = false;
      continue;
    }

    // everyone else
    p.positionStatus = "alive";
    p.eliminated = false;
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT SNAPSHOT
============================================================================ */

export async function emitArena() {
  await recomputePositions();

  io.emit("updateArena", {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,

    isRunning: arena.status === "active",

    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,

    settings: arena.settings,
    firstFinalRound: arena.firstFinalRound,
    lastSortedAt: arena.lastSortedAt,
  });
}

/* ============================================================================
   ROUND CONTROL — start / grace / end
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  // Ronde +1
  arena.round += 1;

  /* -------------------------------------------------------------
      FINALE START DETECTIE — Variant 1
      → We doen NIKS automatisch.
      → Admin kiest wanneer finale begint.
      → Maar wanneer admin type="finale" kiest,
        slaan we op dat DIT de eerste finale-ronde is.
  ------------------------------------------------------------- */
  arena.type = type;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;
    emitLog({
      type: "arena",
      message: `Finale begonnen op ronde #${arena.round}`,
    });
  }

  // Status
  arena.status = "active";

  const now = Date.now();

  const duration =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

  arena.roundStartTime = now;
  arena.roundCutoff = now + duration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  emitLog({
    type: "arena",
    message: `Ronde ${arena.round} gestart (${type}) — duurt ${duration}s`,
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
  });
}

/* ============================================================================
   END ROUND (2 fase systeem)
============================================================================ */

export async function endRound() {
  /* -------------------------------------------------------------
      FASe 1: ACTIVE → GRACE
  ------------------------------------------------------------- */
  if (arena.status === "active") {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: `Grace periode gestart (${arena.settings.graceSeconds}s)`,
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  /* -------------------------------------------------------------
      FASe 2: GRACE → ENDED (Echte eliminaties uitvoeren)
  ------------------------------------------------------------- */
  if (arena.status === "grace") {
    arena.status = "ended";

    // Force update standings 1 last time
    await recomputePositions();

    const total = arena.players.length;

    // Geen danger/elimination als <6 spelers
    if (total < 6) {
      emitLog({
        type: "arena",
        message: `Ronde geëindigd — te weinig spelers voor eliminaties (${total})`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3),
      });

      await emitArena();
      return;
    }

    /* -------------------------------------------------------------
       DOOM LIST (pos 6–8)
    ------------------------------------------------------------- */

    const doomedPlayers = arena.players
      .map((p, i) => ({ p, i }))
      .filter((entry) => entry.i >= 5 && entry.i <= 7)
      .map((entry) => entry.p);

    // Markeer ze als elimination
    for (const entry of doomedPlayers) {
      entry.p.positionStatus = "elimination";
      entry.p.eliminated = true;
    }

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — eliminaties nodig: ${doomedPlayers.length}`,
    });

    // Top 3 output
    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomedPlayers.map((p) => p.username),
      top3,
    });

    await emitArena();
  }
}

/* ============================================================================
   ARENA MANAGEMENT — add / remove / queue
============================================================================ */

export async function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string
) {
  const id = String(tiktok_id);

  if (arena.players.some((p) => p.id === id)) return;

  arena.players.push({
    id,
    username: username.replace(/^@+/, "").toLowerCase(),
    display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  await emitArena();
}

export async function arenaLeave(tiktok_id: string) {
  const id = String(tiktok_id);

  const idx = arena.players.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({ type: "elim", message: `${p.display_name} uit arena verwijderd` });

  await emitArena();
}

export async function addToArena(username: string, resolveUser: Function) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const user = await resolveUser(clean);
  if (!user) throw new Error("Gebruiker niet gevonden");

  if (arena.players.some((p) => p.id === String(user.tiktok_id)))
    throw new Error("Speler zit al in arena");

  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} toegevoegd aan arena`,
  });

  await emitArena();
}

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex((p) => p.username.toLowerCase() === clean);
  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} geëlimineerd`,
  });

  await emitArena();
}

/* ============================================================================
   QUEUE → ARENA
============================================================================ */

export async function addFromQueue(user: any) {
  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  await emitArena();
}

/* ============================================================================
   RESET
============================================================================ */

export async function resetArena() {
  await arenaClear();
}

/* ============================================================================
   SETTINGS
============================================================================ */

export async function updateArenaSettings(
  newSettings: Partial<ArenaSettings>
) {
  arena.settings = { ...arena.settings, ...newSettings };

  io.emit("settings", arena.settings);

  emitLog({
    type: "system",
    message: `Settings aangepast: ${JSON.stringify(newSettings)}`,
  });

  await emitArena();
}

/* ============================================================================
   TIMER LOOP — transitions
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // ACTIVE → GRACE
  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: "⏳ Grace periode gestart",
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  // GRACE → ENDED
  if (arena.status === "grace" && now >= arena.graceEnd) {
    await endRound();
    return;
  }
}, 1000);

/* ============================================================================
   EXPORT
============================================================================ */

export default {
  getArena,
  getArenaSettings,
  emitArena,
  startRound,
  endRound,
  arenaJoin,
  arenaLeave,
  arenaClear,
  addToArena,
  eliminate,
  addFromQueue,
  updateArenaSettings,
  resetArena,
  forceSort,
};
