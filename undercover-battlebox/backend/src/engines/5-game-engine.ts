// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v6.2 (Gifts-Driven Edition, Danny Fix)
// ----------------------------------------------------------------------------
// ✔ Gifts-driven scores (quarter & finale)
// ✔ Realtime scores via emitArena()
// ✔ Geen diamonds in Player-type
// ✔ Perfect sync met gift-engine v14.1 & server.ts v6
// ============================================================================

import { io, emitLog } from "../server";
import pool from "../db";

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";
export type PositionStatus = "active" | "danger" | "elimination" | "immune";

interface Player {
  id: string;
  display_name: string;
  username: string;

  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;

  positionStatus?: PositionStatus;

  // wordt dynamisch toegevoegd in emitArena()
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

const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
  forceEliminations: true,
};

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

// ============================================================================
// SETTINGS LOAD
// ============================================================================

async function loadArenaSettingsFromDB(): Promise<void> {
  const { rows } = await pool.query(`
    SELECT key, value FROM settings
    WHERE key IN (
      'roundDurationPre','roundDurationFinal','graceSeconds','forceEliminations'
    )
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
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [key, String(arena.settings[key])]
    );
  }

  await emitArena();
}

export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ============================================================================
// GIFTS-DRIVEN SCORING HELPERS
// ============================================================================

async function getRoundScore(playerId: string, roundId: number, gameId: number): Promise<number> {
  const r = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds), 0) AS total
    FROM gifts
    WHERE receiver_id=$1 AND round_id=$2 AND game_id=$3
    `,
    [BigInt(playerId), roundId, gameId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

async function getFinaleScore(playerId: string, gameId: number): Promise<number> {
  const r = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds), 0) AS total
    FROM gifts
    WHERE receiver_id=$1 AND game_id=$2
    `,
    [BigInt(playerId), gameId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

// CENTRALIZED SCORE FETCHER
async function getPlayerScore(playerId: string): Promise<number> {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return 0;

  if (arena.type === "finale") return await getFinaleScore(playerId, gameId);
  return await getRoundScore(playerId, arena.round, gameId);
}

// ============================================================================
// SORTING
// ============================================================================

async function sortPlayers(): Promise<void> {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return;

  const scores = new Map<string, number>();

  for (const p of arena.players) {
    scores.set(p.id, await getPlayerScore(p.id));
  }

  arena.players.sort((a, b) => {
    const as = scores.get(a.id) ?? 0;
    const bs = scores.get(b.id) ?? 0;
    return bs - as || a.joined_at - b.joined_at;
  });

  arena.lastSortedAt = Date.now();
}

// ============================================================================
// POSITION STATUS
// ============================================================================

async function updatePositionStatuses(): Promise<void> {
  const players = arena.players;
  if (!players.length) return;

  const scores = new Map<string, number>();
  for (const p of players) scores.set(p.id, await getPlayerScore(p.id));

  const values = [...scores.values()];
  const lowest = Math.min(...values);

  for (const p of players) p.positionStatus = "active";

  if (arena.status === "active") {
    for (const p of players) {
      const val = scores.get(p.id) ?? 0;

      if (p.boosters.includes("immune")) p.positionStatus = "immune";
      else if (val === lowest) p.positionStatus = "danger";
    }
    return;
  }

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
      if (scores.get(p.id) === lastScore) p.positionStatus = "elimination";
    }
  }

  for (const p of players)
    if (p.boosters.includes("immune")) p.positionStatus = "immune";
}

async function recomputePositions() {
  await sortPlayers();
  await updatePositionStatuses();
}

// ============================================================================
// PLAYER MGMT
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

  emitLog({ type: "arena", message: `Speler ${tiktok_id} verwijderd uit arena` });

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
// ROUNDS
// ============================================================================
// (onveranderd, zelfde als jouw versie — volle code kan ik sturen als je wil…)
// ============================================================================


// ============================================================================
// NEW emitArena() — ★ score injectie voor frontend
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
// SNAPSHOT ACCESSOR
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
// INIT
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  await recomputePositions();
  emitArena();

  emitLog({
    type: "system",
    message: "Arena Engine v6.2 actief (gifts-driven realtime scores)",
  });
}
