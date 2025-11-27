/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v14.0 FINAL
   ✔ Compatibel met server.ts v6.x
   ✔ Compatible met twist-engine v3.x (boosters & state mapping)
   ✔ Gifts-driven scores
   ✔ Full queue support
   ✔ No disable buttons bug
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;

  // engine v14 uses boosters[] + positionStatus = twist compatible
  boosters: string[];

  // UI-driven state
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";

  // twist-engine v3 compatibility virtual flag
  eliminated?: boolean;
}

interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
}

interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: RoundType;
  status: ArenaStatus;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;

  lastSortedAt: number;
}

/* ============================================================================
   MEMORY
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
    roundDurationPre: 60,
    roundDurationFinal: 60,
    graceSeconds: 10,
    forceEliminations: true,
  },

  lastSortedAt: 0,
};

/* ============================================================================
   BASIC GETTERS FOR server.ts
============================================================================ */

export function getArena(): ArenaState {
  return arena;
}

export function getArenaSettings(): ArenaSettings {
  return arena.settings;
}

/* ============================================================================
   SCORE FETCHER
============================================================================ */

async function getPlayerScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1 AND game_id=$2
    `,
    [BigInt(tiktokId), gid]
  );

  return Number(q.rows[0]?.score ?? 0);
}

/* ============================================================================
   SORTING & STATUS ASSIGNMENT
============================================================================ */

async function recomputePositions() {
  // refresh scores
  for (const p of arena.players) {
    p.score = await getPlayerScore(p.id);
  }

  arena.players.sort((a, b) => b.score - a.score);

  const total = arena.players.length;

  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      continue;
    }

    // lowest 3 = elimination
    if (i >= total - 3) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    // next 2 = danger
    else if (i >= total - 5) {
      p.positionStatus = "danger";
      p.eliminated = false;
    }

    // others = alive
    else {
      p.positionStatus = "alive";
      p.eliminated = false;
    }
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT ARENA SNAPSHOT
============================================================================ */

export async function emitArena() {
  await recomputePositions();

  io.emit("updateArena", {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,

    isRunning: arena.status === "active",
    timeLeft: 0,

    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,

    settings: arena.settings,
    lastSortedAt: arena.lastSortedAt,
  });
}

/* ============================================================================
   ROUND CONTROL
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena");

  arena.type = type;
  arena.round += 1;
  arena.status = "active";

  const dur =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

  const now = Date.now();

  arena.roundStartTime = now;
  arena.roundCutoff = now + dur * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  emitLog({ type: "arena", message: `Ronde gestart (${type})` });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration: dur,
  });
}

export async function endRound() {
  if (arena.status === "active") {
    arena.status = "grace";
    await emitArena();

    emitLog({ type: "arena", message: "Grace gestart" });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    return;
  }

  if (arena.status === "grace") {
    arena.status = "ended";

    await recomputePositions();

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — eliminaties nodig (${doomed.length})`,
    });

    await emitArena();
  }
}

/* ============================================================================
   ARENA MANAGEMENT (Compatibel met server.ts & admin frontend)
============================================================================ */

/**
 * arenaJoin(tiktok_id, display_name, username)
 * Wordt gebruikt door server.ts → ADD TO ARENA
 */
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
    boosters: [],            // twist-engine expects this
    eliminated: false,       // twist-engine expects this
    positionStatus: "alive",
  });

  await emitArena();
}

/**
 * arenaLeave(tiktok_id)
 * Wordt gebruikt door server.ts → ELIMINATE
 */
export async function arenaLeave(tiktok_id: string) {
  const id = String(tiktok_id);

  const idx = arena.players.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} uit arena verwijderd`,
  });

  await emitArena();
}

/**
 * arenaClear() — gebruikt door startGame(), hardResetGame(), resetArena()
 */
export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.type = "quarter";
  arena.status = "idle";

  arena.roundStartTime = 0;
  arena.roundCutoff = 0;
  arena.graceEnd = 0;

  arena.lastSortedAt = Date.now();

  emitLog({ type: "system", message: "Arena volledig geleegd" });

  await emitArena();
}

/**
 * addToArena(username) — moderne admin call
 */
export async function addToArena(username: string, resolveUser: Function) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const user = await resolveUser(clean);
  if (!user) throw new Error("Gebruiker niet gevonden");

  const exists = arena.players.find((p) => p.id === String(user.tiktok_id));
  if (exists) throw new Error("Speler zit al in arena");

  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username,
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

/**
 * eliminate(username) — gebruikt door twists & admin panel
 */
export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex(
    (p) => p.username.toLowerCase() === clean
  );

  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} geëlimineerd`,
  });

  await emitArena();
}

/**
 * addFromQueue(user) — queue → arena (server.ts)
 */
export async function addFromQueue(user: any) {
  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username,
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  await emitArena();
}

/* ============================================================================
   SETTINGS / RESET
============================================================================ */

export async function resetArena() {
  await arenaClear();
}

export async function updateArenaSettings(
  newSettings: Partial<ArenaState["settings"]>
) {
  arena.settings = {
    ...arena.settings,
    ...newSettings,
  };

  io.emit("settings", arena.settings);

  emitLog({
    type: "system",
    message: `Settings aangepast: ${JSON.stringify(newSettings)}`,
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
   TIMER LOOP — CORE ROUND LOGIC TICKS
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
    arena.status = "ended";

    await recomputePositions();

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `⛔ Ronde beëindigd — eliminaties nodig (${doomed.length})`,
    });

    await emitArena();
  }
}, 1000);

/* ============================================================================
   🟩 FINAL EXPORT — EXACT WAT server.ts VERWACHT
============================================================================ */

export default {
  // Basic getters
  getArena,
  getArenaSettings,

  // Emit helpers
  emitArena,

  // Rounds
  startRound,
  endRound,

  // Arena mgmt (legacy + modern)
  arenaJoin,
  arenaLeave,
  arenaClear,
  addToArena,
  eliminate,
  addFromQueue,

  // Settings / reset
  updateArenaSettings,
  resetArena,

  // Utility
  forceSort,
};
