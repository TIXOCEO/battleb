// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v6.3 (Gifts-Driven, Danny Stable)
// ----------------------------------------------------------------------------
// ✔ 100% gifts-driven scoring (geen diamonds in users)
// ✔ Frontend krijgt realtime score via emitArena()
// ✔ Finale = total diamonds in hele game
// ✔ Quarter = diamonds in huidige ronde
// ✔ startRound & endRound volledig aanwezig
// ✔ exports allemaal top-level (geen TS fouten)
// ============================================================================

import { io, emitLog } from "../server";
import pool from "../db";

// ============================================================
// TYPES
// ============================================================

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";
export type PositionStatus = "active" | "danger" | "elimination" | "immune";

export interface Player {
  id: string;
  display_name: string;
  username: string;

  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;

  positionStatus?: PositionStatus;

  // injected later
  score?: number;
}

interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
}

interface Arena {
  players: Player[];
  round: number;
  type: RoundType;
  status: ArenaStatus;

  timeLeft: number;
  isRunning: boolean;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;
  lastSortedAt: number;
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
  forceEliminations: true,
};

// ============================================================
// INTERNAL ARENA STATE
// ============================================================

const arena: Arena = {
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",

  timeLeft: 0,
  isRunning: false,

  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,

  settings: { ...DEFAULT_SETTINGS },
  lastSortedAt: Date.now(),
};

// ============================================================
// SETTINGS LOAD/SAVE
// ============================================================

async function loadArenaSettingsFromDB(): Promise<void> {
  const { rows } = await pool.query(`
    SELECT key, value FROM settings
    WHERE key IN ('roundDurationPre','roundDurationFinal','graceSeconds','forceEliminations')
  `);

  const map = new Map(rows.map((r: any) => [r.key, r.value]));

  arena.settings = {
    roundDurationPre: Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre),
    roundDurationFinal: Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal),
    graceSeconds: Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds),
    forceEliminations: (map.get("forceEliminations") ?? "true") === "true",
  };
}

export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  arena.settings = { ...arena.settings, ...s };

  for (const key of Object.keys(arena.settings) as (keyof ArenaSettings)[]) {
    await pool.query(
      `INSERT INTO settings(key,value)
       VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, String(arena.settings[key])]
    );
  }

  await emitArena();
}

export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ============================================================
// SCORING HELPERS (gifts-driven)
// ============================================================

async function getRoundScore(playerId: string, roundId: number, gameId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS total
     FROM gifts
     WHERE receiver_id=$1 AND round_id=$2 AND game_id=$3`,
    [BigInt(playerId), roundId, gameId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

async function getFinaleScore(playerId: string, gameId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS total
     FROM gifts
     WHERE receiver_id=$1 AND game_id=$2`,
    [BigInt(playerId), gameId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

async function getPlayerScore(playerId: string): Promise<number> {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return 0;

  if (arena.type === "finale") return await getFinaleScore(playerId, gameId);
  return await getRoundScore(playerId, arena.round, gameId);
}

// ============================================================
// SORTING
// ============================================================

async function sortPlayers(): Promise<void> {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return;

  const scoreMap = new Map<string, number>();

  for (const p of arena.players) {
    scoreMap.set(p.id, await getPlayerScore(p.id));
  }

  arena.players.sort((a, b) => {
    const as = scoreMap.get(a.id) ?? 0;
    const bs = scoreMap.get(b.id) ?? 0;
    return bs - as || a.joined_at - b.joined_at;
  });

  arena.lastSortedAt = Date.now();
}

// ============================================================
// POSITION STATUS
// ============================================================

async function updatePositionStatuses(): Promise<void> {
  const players = arena.players;
  if (!players.length) return;

  const scores = new Map<string, number>();
  for (const p of players) scores.set(p.id, await getPlayerScore(p.id));

  const values = [...scores.values()];
  const lowest = Math.min(...values);

  // reset default
  for (const p of players) p.positionStatus = "active";

  if (arena.status === "active") {
    for (const p of players) {
      const val = scores.get(p.id) ?? 0;
      if (p.boosters.includes("immune")) p.positionStatus = "immune";
      else if (val === lowest) p.positionStatus = "danger";
    }
    return;
  }

  // grace / ended → eliminations
  await sortPlayers();

  if (arena.type === "quarter") {
    const q = [...players];
    const elimIdx = [5, 6, 7].filter((i) => q[i]);

    for (const idx of elimIdx) {
      const ref = q[idx];
      const score = scores.get(ref.id);
      for (const p of players) {
        if (scores.get(p.id) === score) p.positionStatus = "elimination";
      }
    }
  }

  if (arena.type === "finale") {
    const lastScore = scores.get(players[players.length - 1].id) ?? 0;
    for (const p of players) {
      if ((scores.get(p.id) ?? 0) === lastScore) p.positionStatus = "elimination";
    }
  }

  // immune overrides
  for (const p of players)
    if (p.boosters.includes("immune")) p.positionStatus = "immune";
}

async function recomputePositions() {
  await sortPlayers();
  await updatePositionStatuses();
}

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string
): boolean {
  if (!tiktok_id) return false;

  const id = String(tiktok_id);

  if (arena.players.some((p) => p.id === id)) return false;

  arena.players.push({
    id,
    display_name,
    username: username.replace(/^@+/, ""),
    boosters: [],
    status: "alive",
    joined_at: Date.now(),
    positionStatus: "active",
  });

  emitLog({ type: "arena", message: `${display_name} toegevoegd aan arena` });
  recomputePositions();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string) {
  arena.players = arena.players.filter((p) => p.id !== String(tiktok_id));

  emitLog({
    type: "arena",
    message: `Speler ${tiktok_id} verwijderd uit arena`,
  });

  recomputePositions();
  emitArena();
}

export async function arenaClear() {
  emitLog({ type: "system", message: `Arena leeg` });

  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.isRunning = false;

  await recomputePositions();
  emitArena();
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

let roundTick: NodeJS.Timeout | null = null;

export function startRound(type: RoundType): boolean {
  // block start if pending eliminations
  const hasPending =
    arena.settings.forceEliminations &&
    arena.players.some((p) => p.positionStatus === "elimination");

  if (hasPending) {
    emitLog({
      type: "error",
      message: `Kan geen ronde starten: pending eliminaties`,
    });
    return false;
  }

  if (arena.status !== "idle" && arena.status !== "ended") return false;
  if (arena.players.length < 1) return false;

  arena.round++;
  arena.type = type;

  const duration =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

  arena.status = "active";
  arena.isRunning = true;
  arena.timeLeft = duration;

  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + duration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  emitLog({
    type: "arena",
    message: `Ronde gestart (#${arena.round}) type: ${type}`,
  });

  recomputePositions();
  emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
  });

  if (roundTick) clearInterval(roundTick);
  roundTick = setInterval(tick, 1000);

  return true;
}

// ============================================================================
// TICK
// ============================================================================

async function tick() {
  const now = Date.now();

  if (arena.status === "active") {
    const left = Math.max(0, Math.ceil((arena.roundCutoff - now) / 1000));
    arena.timeLeft = left;

    if (left <= 0) {
      // switch to grace
      arena.status = "grace";
      arena.isRunning = false;
      arena.timeLeft = 0;

      emitLog({
        type: "arena",
        message: `Grace-periode gestart (${arena.settings.graceSeconds}s)`,
      });

      await recomputePositions();
      emitArena();

      io.emit("round:grace", {
        round: arena.round,
        grace: arena.settings.graceSeconds,
      });
    } else {
      await recomputePositions();
      emitArena();
    }

    return;
  }

  if (arena.status === "grace") {
    if (now >= arena.graceEnd) {
      await endRound();
    } else {
      await recomputePositions();
      emitArena();
    }
    return;
  }

  // cleanup
  if (arena.status === "ended" || arena.status === "idle") {
    if (roundTick) clearInterval(roundTick);
    roundTick = null;
  }
}

// ============================================================================
// END ROUND
// ============================================================================

export async function endRound(): Promise<void> {
  await recomputePositions();

  const pending = arena.players.filter(
    (p) => p.positionStatus === "elimination"
  );

  if (arena.settings.forceEliminations && pending.length > 0) {
    // eliminations required → round ends but remains "ended"
    emitLog({
      type: "system",
      message: `Ronde beëindigd — pending eliminaties (${pending.length})`,
    });

    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;

    emitArena();

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: pending.map((p) => p.id),
      top3: await getTopPlayers(3),
    });

    return;
  }

  // fully end & return to idle
  arena.status = "idle";
  arena.isRunning = false;
  arena.timeLeft = 0;

  emitLog({
    type: "arena",
    message: `Ronde afgerond (#${arena.round})`,
  });

  emitArena();

  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    pendingEliminations: [],
    top3: await getTopPlayers(3),
  });

  if (roundTick) clearInterval(roundTick);
  roundTick = null;
}

// ============================================================================
// TOP PLAYERS
// ============================================================================

async function getTopPlayers(n: number) {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return [];

  const out = [];

  for (const p of arena.players) {
    const score = await getPlayerScore(p.id);
    out.push({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: score,
    });
  }

  return out.sort((a, b) => b.diamonds - a.diamonds).slice(0, n);
}

// ============================================================================
// ARENA SNAPSHOT
// ============================================================================

export function getArena() {
  return {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,
    timeLeft: arena.timeLeft,
    isRunning: arena.isRunning,

    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,

    settings: arena.settings,
    lastSortedAt: arena.lastSortedAt,
  };
}

// ============================================================================
// emitArena() — injecteert dynamic score voor frontend
// ============================================================================

export async function emitArena() {
  try {
    const gameId = (io as any)?.currentGameId ?? null;
    const base = getArena();

    if (gameId) {
      for (const p of base.players) {
        p.score = await getPlayerScore(p.id);
      }
    }

    io.emit("updateArena", base);
  } catch (err) {
    console.warn("emitArena error:", err);
  }
}

// ============================================================================
// INIT
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  await recomputePositions();
  emitArena();

  emitLog({
    type: "system",
    message: "Arena Engine v6.3 actief (gifts-driven realtime scores)",
  });
}

// ============================================================================
// EXPORTS (TOP-LEVEL, BUILD-SAFE)
// ============================================================================

export {
  startRound,
  endRound,
  arenaJoin,
  arenaLeave,
  arenaClear,
  getArena,
  emitArena,
  getArenaSettings,
};
