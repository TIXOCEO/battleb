/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v14.3
   ✔ Danger tijdens ronde (pos 6–8)
   ✔ Eliminations alleen NA de ronde
   ✔ Idle → alles alive
   ✔ Immune blijft immune
   ✔ Fix: nieuwe spelers nooit meteen elimination
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

  boosters: string[];
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
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
   GETTERS
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
   POSITION COMPUTATION — jouw regels!
============================================================================ */

async function recomputePositions() {
  const status = arena.status;

  // Update all scores first
  for (const p of arena.players) {
    p.score = await getPlayerScore(p.id);
  }

  // Sort high → low score
  arena.players.sort((a, b) => b.score - a.score);

  const total = arena.players.length;

  // ----------------------------------------------------------------------------
  // IDLE MODE — geen danger, geen elimination
  // ----------------------------------------------------------------------------
  if (status === "idle") {
    for (const p of arena.players) {
      p.positionStatus = p.boosters.includes("immune") ? "immune" : "alive";
      p.eliminated = false;
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  // ----------------------------------------------------------------------------
  // ACTIVE + GRACE — gevaarzones, maar GEEN eliminations!
  // pos 1–5 alive
  // pos 6–8 danger
  // pos >8 alive
  // onder 6 spelers: alles alive
  // ----------------------------------------------------------------------------
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    // Immune = overschrijft alles
    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      p.eliminated = false;
      continue;
    }

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

    // Everyone above pos 8 = safe
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

  const now = Date.now();
  const dur =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

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
  // -----------------------
  // ACTIVE → GRACE
  // -----------------------
  if (arena.status === "active") {
    arena.status = "grace";

    emitLog({ type: "arena", message: "Grace gestart" });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  // -----------------------
  // GRACE → ENDED
  // -----------------------
  if (arena.status === "grace") {
    arena.status = "ended";

    await recomputePositions();

    // Bepaal ECHTE eliminaties: pos 6–8 (index 5–7)
    const doomed = arena.players
      .filter((_p, i) => i >= 5 && i <= 7)
      .map((p) => p.username);

    // Markeer deze nu als elimination
    arena.players.forEach((p, i) => {
      if (i >= 5 && i <= 7) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }
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
   ARENA MANAGEMENT
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

  emitLog({ type: "arena", message: `${user.display_name} toegevoegd aan arena` });

  await emitArena();
}

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex((p) => p.username.toLowerCase() === clean);
  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({ type: "elim", message: `${p.display_name} geëlimineerd` });

  await emitArena();
}

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
   SETTINGS
============================================================================ */

export async function resetArena() {
  await arenaClear();
}

export async function updateArenaSettings(
  newSettings: Partial<ArenaState["settings"]>
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
   MANUAL SORT
============================================================================ */

export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

/* ============================================================================
   TIMER LOOP — automated round transitions
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

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
