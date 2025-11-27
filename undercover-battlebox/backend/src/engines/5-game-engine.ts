/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v15.1
   ✔ Correct round_id scoring (alleen is_round_gift=TRUE)
   ✔ Correct finale baseline
   ✔ Danger 6–8 alleen tijdens ronde
   ✔ Eliminaties na grace
   ✔ DB settings (arena_settings table)
   ✔ Compatibel met gift-engine v14.2 & server v7.3
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;                     // TikTok ID
  username: string;
  display_name: string;
  score: number;                  // DB-based score

  boosters: string[];
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
  eliminated?: boolean;
}

export interface ArenaSettings {
  roundDurationPre: number;       // seconds
  roundDurationFinal: number;     // seconds
  graceSeconds: number;           // seconds
  forceEliminations: boolean;
}

export interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: RoundType;
  status: ArenaStatus;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;

  firstFinalRound: number | null; // determines baseline for finals
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
    roundDurationPre: 300,       // overwritten by DB
    roundDurationFinal: 180,     // overwritten by DB
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
    SELECT round_pre_seconds, round_final_seconds, grace_seconds
    FROM arena_settings
    ORDER BY id ASC
    LIMIT 1
  `);

  if (!r.rows.length) {
    console.log("⚠ Geen arena_settings gevonden — defaults blijven actief.");
    return;
  }

  const row = r.rows[0];

  arena.settings.roundDurationPre = Number(row.round_pre_seconds);
  arena.settings.roundDurationFinal = Number(row.round_final_seconds);
  arena.settings.graceSeconds = Number(row.grace_seconds);

  console.log("✔ Arena settings geladen uit DB:", arena.settings);
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
   SCORE SYSTEM — PURE DB, ROUND-BASED + is_round_gift=TRUE
============================================================================ */

// Score voor één ronde (alleen echte ronde-gifts)
async function getRoundScore(tiktokId: string, round: number): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid || !round) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id=$3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, round]
  );

  return Number(q.rows[0]?.score || 0);
}

// Score voor FINALE (baseline + finale, alleen ronde-gifts)
async function getFinalScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;
  if (!arena.firstFinalRound) return 0;

  const first = arena.firstFinalRound;

  // A) Baseline = alle voorrondes (met is_round_gift=TRUE)
  const baselineQ = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id < $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  // B) Finale rondes (≥ firstFinalRound, ook alleen ronde-gifts)
  const finaleQ = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id >= $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  return (
    Number(baselineQ.rows[0]?.score || 0) +
    Number(finaleQ.rows[0]?.score || 0)
  );
}

// Automatische score router
async function computePlayerScore(player: ArenaPlayer): Promise<number> {
  if (arena.type === "finale") {
    return await getFinalScore(player.id);
  }

  // Quarter / normal rounds
  return await getRoundScore(player.id, arena.round);
}

/* ============================================================================
   POSITION COMPUTATION — Danger 6–8 ONLY
============================================================================ */

async function recomputePositions() {
  const status = arena.status;

  // Update score voor elke speler
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // Sorteren
  arena.players.sort((a, b) => b.score - a.score);

  const total = arena.players.length;

  /* -------------------------------------------------------------
     IDLE — iedereen veilig
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
     ACTIVE / GRACE — danger posities 6–8
  ------------------------------------------------------------- */
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    // immune override
    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      p.eliminated = false;
      continue;
    }

    // minder dan 6 spelers → geen danger
    if (total < 6) {
      p.positionStatus = "alive";
      p.eliminated = false;
      continue;
    }

    if (i <= 4) {
      p.positionStatus = "alive";
      p.eliminated = false;
      continue;
    }

    if (i >= 5 && i <= 7) {
      p.positionStatus = "danger";
      p.eliminated = false;
      continue;
    }

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
   START ROUND
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  // Nieuwe ronde +1
  arena.round += 1;

  // Finale-detectie (Variant 1: admin triggered)
  arena.type = type;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;

    emitLog({
      type: "arena",
      message: `Finale gestart op ronde #${arena.round}`,
    });
  }

  // Active mode
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
    message: `Ronde ${arena.round} gestart (${type}) — duur: ${duration}s`,
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
  });
}

/* ============================================================================
   END ROUND — 2 fase eliminatie
============================================================================ */

export async function endRound() {
  // FASe 1: ACTIVE → GRACE
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

  // FASe 2: GRACE → ENDED
  if (arena.status === "grace") {
    arena.status = "ended";

    // Nog 1 keer correcte sort
    await recomputePositions();

    const total = arena.players.length;

    // Te weinig spelers → niemand elimineren
    if (total < 6) {
      emitLog({
        type: "arena",
        message: `Ronde geëindigd — minder dan 6 spelers (${total}), geen eliminaties.`,
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

    // Eliminatie: posities 6–8 → indexes 5–7
    const doomed = arena.players
      .map((p, index) => ({ p, index }))
      .filter((entry) => entry.index >= 5 && entry.index <= 7)
      .map((entry) => entry.p);

    // Markeer ze
    for (const p of doomed) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — eliminaties: ${doomed.length}`,
    });

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed.map((p) => p.username),
      top3,
    });

    await emitArena();
  }
}

/* ============================================================================
   ARENA MANAGEMENT — JOIN / LEAVE
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

/* ============================================================================
   ADD BY USER LOOKUP
============================================================================ */

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

/* ============================================================================
   ELIMINATE
============================================================================ */

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex((p) => p.username.toLowerCase() === clean);
  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({ type: "elim", message: `${p.display_name} geëlimineerd` });

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
   ARENA CLEAR (Complete reset)
============================================================================ */

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;

  emitLog({
    type: "arena",
    message: "Arena gereset",
  });

  await emitArena();
}

/* ============================================================================
   FORCE SORT
============================================================================ */

export async function forceSort() {
  await recomputePositions();
  await emitArena();
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
    message: `Settings geüpdatet: ${JSON.stringify(newSettings)}`,
  });

  await emitArena();
}

/* ============================================================================
   TIMER LOOP — ACTIVE → GRACE → ENDED
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
  resetArena: arenaClear,

  forceSort,
};
