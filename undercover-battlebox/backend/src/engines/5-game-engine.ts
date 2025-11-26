// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v6.0 (Gifts-Driven Edition)
// ----------------------------------------------------------------------------
// ✔ Geen diamonds meer in users-table
// ✔ Geen safeAddArenaDiamonds() meer
// ✔ Quarter scores = SUM(diamonds) FROM gifts WHERE game_id + round_id
// ✔ Finale scores = SUM(diamonds) FROM gifts WHERE game_id
// ✔ Arena players hebben GEEN diamonds property meer
// ✔ Dangerous / elimination volledig gifts-driven
// ✔ Perfecte sync met gift-engine v14
// ============================================================================

import { io, emitLog } from "../server";
import pool from "../db";

// =======================================
// TYPES
// =======================================

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

// =======================================
// DEFAULT SETTINGS
// =======================================

const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
  forceEliminations: true,
};

// =======================================
// INTERNAL STATE
// =======================================

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
// SETTINGS LOAD + SAVE
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

  emitArena();
}

export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ============================================================================
// GIFTS-DRIVEN SCORE HELPERS
// ============================================================================

// Quarter score (per ronde)
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

// Finale score (totaal in hele game)
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

// ============================================================================
// SORTING
// ============================================================================

async function sortPlayers(): Promise<void> {
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return;

  const scores = new Map<string, number>();

  if (arena.type === "finale") {
    // Finale = total game score
    for (const p of arena.players) {
      scores.set(p.id, await getFinaleScore(p.id, gameId));
    }
  } else {
    // Quarter = round score only
    for (const p of arena.players) {
      scores.set(p.id, await getRoundScore(p.id, arena.round, gameId));
    }
  }

  arena.players.sort((a, b) => {
    const as = scores.get(a.id) ?? 0;
    const bs = scores.get(b.id) ?? 0;
    return bs - as || a.joined_at - b.joined_at;
  });

  arena.lastSortedAt = Date.now();
}

// ============================================================================
// POSITION STATUSES
// ============================================================================

async function updatePositionStatuses(): Promise<void> {
  const p = arena.players;
  if (!p.length) return;

  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return;

  const scores = new Map<string, number>();

  if (arena.type === "finale") {
    for (const pl of p) scores.set(pl.id, await getFinaleScore(pl.id, gameId));
  } else {
    for (const pl of p)
      scores.set(pl.id, await getRoundScore(pl.id, arena.round, gameId));
  }

  const values = [...scores.values()];
  const lowest = Math.min(...values);

  for (const pl of p) pl.positionStatus = "active";

  if (arena.status === "active") {
    for (const pl of p) {
      const val = scores.get(pl.id) ?? 0;
      if (pl.boosters.includes("immune")) pl.positionStatus = "immune";
      else if (val === lowest) pl.positionStatus = "danger";
    }
    return;
  }

  // Grace or end → elimination
  await sortPlayers();

  if (arena.type === "quarter") {
    const qPlayers = [...p];
    const elimPos = [5, 6, 7].filter((i) => qPlayers[i]);

    for (const pos of elimPos) {
      const target = qPlayers[pos];
      const score = scores.get(target.id);

      for (const pl of p) {
        if ((scores.get(pl.id) ?? -1) === score) {
          pl.positionStatus = "elimination";
        }
      }
    }
  }

  if (arena.type === "finale") {
    const lastScore = scores.get(p[p.length - 1].id) ?? 0;
    for (const pl of p) {
      if ((scores.get(pl.id) ?? -1) === lastScore)
        pl.positionStatus = "elimination";
    }
  }

  for (const pl of p)
    if (pl.boosters.includes("immune")) pl.positionStatus = "immune";
}

async function recomputePositions(): Promise<void> {
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
    display_name: display_name ?? "Onbekend",
    username: (username ?? "").replace(/^@+/, ""),
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

export function arenaLeave(tiktok_id: string): void {
  const id = String(tiktok_id);
  arena.players = arena.players.filter((p) => p.id !== id);

  emitLog({ type: "arena", message: `Speler ${id} verwijderd uit arena` });

  sortPlayers();
  emitArena();
}

export async function arenaClear(): Promise<void> {
  emitLog({ type: "system", message: `Arena volledig geleegd` });

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
  if (
    arena.settings.forceEliminations &&
    arena.players.some((p) => p.positionStatus === "elimination")
  ) {
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

  if (arena.status === "ended" || arena.status === "idle") {
    if (roundTick) clearInterval(roundTick);
    roundTick = null;
  }
}

// ============================================================================
// END ROUND — gifts-driven
// ============================================================================

export async function endRound(): Promise<void> {
  await recomputePositions();

  const pending = arena.players.filter(
    (p) => p.positionStatus === "elimination"
  );

  if (arena.settings.forceEliminations && pending.length > 0) {
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
// TOP PLAYERS — gifts-driven
// ============================================================================

async function getTopPlayers(n: number) {
  const out = [];
  const gameId = (io as any)?.currentGameId ?? null;
  if (!gameId) return [];

  for (const p of arena.players) {
    const total = await getFinaleScore(p.id, gameId);
    out.push({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: total,
    });
  }

  return out.sort((a, b) => b.diamonds - a.diamonds).slice(0, n);
}

// ============================================================================
// SNAPSHOT / EXPORT
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

export function emitArena() {
  try {
    io.emit("updateArena", getArena());
  } catch (e) {
    console.warn("⚠ emitArena failed:", e);
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
    message: "Arena Engine v6.0 gereed (gifts-driven scores actief)",
  });
}
