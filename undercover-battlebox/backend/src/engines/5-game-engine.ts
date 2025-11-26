// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v14.0 (Gifts-Only Architecture)
// ----------------------------------------------------------------------------
// ✔ Finale score = SUM(diamonds) FROM gifts WHERE game_id=? AND receiver_role='speler'
// ✔ Quarter score = SUM(diamonds) FROM gifts WHERE game_id=? AND round_id=?
// ✔ Arena local diamonds = VISUEEL voor sorting, NIET persistent
// ✔ 0 dubbele tellingen, 0 inconsistentie
// ✔ Host gifts strikt gescheiden via receiver_role='host'
// ✔ Realtime sorting triggered by safeAddArenaDiamonds()
// ✔ Eliminaties volledig herzien
// ============================================================================

import pool from "../db";
import { io, emitLog } from "../server";

// ============================================================================
// TYPES
// ============================================================================

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";
export type PositionStatus = "active" | "danger" | "elimination" | "immune";

interface Player {
  id: string;
  display_name: string;
  username: string;

  // ronde-score enkel visueel
  diamonds: number;

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

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
  forceEliminations: true,
};

// ============================================================================
// INTERNAL ARENA STATE
// ============================================================================

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

async function loadArenaSettingsFromDB() {
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

export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ============================================================================
// REALTIME SCORE HELPERS (GIFTS ONLY)
// ============================================================================

async function getQuarterScore(gameId: number, round: number, id: string): Promise<number> {
  const r = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds),0) AS diamonds
    FROM gifts
    WHERE game_id=$1
      AND round_id=$2
      AND receiver_id=$3
      AND receiver_role='speler'
    `,
    [gameId, round, BigInt(id)]
  );
  return Number(r.rows[0]?.diamonds ?? 0);
}

async function getFinaleScore(gameId: number, id: string): Promise<number> {
  const r = await pool.query(
    `
    SELECT COALESCE(SUM(diamonds),0) AS diamonds
    FROM gifts
    WHERE game_id=$1
      AND receiver_id=$2
      AND receiver_role='speler'
    `,
    [gameId, BigInt(id)]
  );
  return Number(r.rows[0]?.diamonds ?? 0);
}

// ============================================================================
// SORTING
// ============================================================================

async function sortPlayers() {
  const gameId = (io as any)?.currentGameId;
  if (!gameId) return;

  if (arena.type === "finale") {
    // finale → totaal game
    const map = new Map<string, number>();
    for (const p of arena.players) {
      map.set(p.id, await getFinaleScore(gameId, p.id));
    }

    arena.players.sort((a, b) => {
      const sa = map.get(a.id) ?? 0;
      const sb = map.get(b.id) ?? 0;
      return sb - sa || a.joined_at - b.joined_at;
    });
  } else {
    // quarter → ronde
    const map = new Map<string, number>();
    for (const p of arena.players) {
      map.set(p.id, await getQuarterScore(gameId, arena.round, p.id));
    }

    arena.players.sort((a, b) => {
      const sa = map.get(a.id) ?? 0;
      const sb = map.get(b.id) ?? 0;
      return sb - sa || a.joined_at - b.joined_at;
    });
  }

  arena.lastSortedAt = Date.now();
}

// ============================================================================
// POSITION STATUS UPDATE
// ============================================================================

async function updatePositionStatuses() {
  const p = arena.players;
  const gameId = (io as any)?.currentGameId;
  if (!gameId || !p.length) return;

  for (const pl of p) pl.positionStatus = "active";

  if (arena.status === "active") {
    let lowest = Infinity;

    if (arena.type === "finale") {
      const scores = await Promise.all(
        p.map(pl => getFinaleScore(gameId, pl.id))
      );
      lowest = Math.min(...scores);
    } else {
      const scores = await Promise.all(
        p.map(pl => getQuarterScore(gameId, arena.round, pl.id))
      );
      lowest = Math.min(...scores);
    }

    for (const pl of p) {
      let s =
        arena.type === "finale"
          ? await getFinaleScore(gameId, pl.id)
          : await getQuarterScore(gameId, arena.round, pl.id);

      if (pl.boosters.includes("immune")) {
        pl.positionStatus = "immune";
      } else if (s === lowest) {
        pl.positionStatus = "danger";
      }
    }
    return;
  }

  // grace or ended → mark eliminations
  await sortPlayers();

  if (arena.type === "quarter") {
    const elimPos = [5, 6, 7].filter(i => p[i]);
    const targets = elimPos.map(i => p[i]);

    for (const target of targets) {
      const tScore = await getQuarterScore(gameId, arena.round, target.id);
      for (const pl of p) {
        const s = await getQuarterScore(gameId, arena.round, pl.id);
        if (s === tScore) pl.positionStatus = "elimination";
      }
    }
  }

  if (arena.type === "finale") {
    const lastScore = await getFinaleScore(gameId, p[p.length - 1].id);
    for (const pl of p) {
      const s = await getFinaleScore(gameId, pl.id);
      if (s === lastScore) pl.positionStatus = "elimination";
    }
  }

  for (const pl of p)
    if (pl.boosters.includes("immune"))
      pl.positionStatus = "immune";
}

// ============================================================================
// RECOMPUTE
// ============================================================================

async function recomputePositions() {
  await sortPlayers();
  await updatePositionStatuses();
}

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

export function arenaJoin(id: string, display_name: string, username: string) {
  const cleanId = String(id);
  if (arena.players.some(p => p.id === cleanId)) return false;

  arena.players.push({
    id: cleanId,
    display_name: display_name ?? "Onbekend",
    username: (username ?? "").replace(/^@+/, ""),
    boosters: [],
    diamonds: 0, // local-only
    status: "alive",
    joined_at: Date.now(),
    positionStatus: "active",
  });

  emitLog({ type: "arena", message: `${display_name} toegevoegd aan arena` });

  recomputePositions();
  emitArena();
  return true;
}

export function arenaLeave(id: string) {
  arena.players = arena.players.filter(p => p.id !== id);

  emitLog({ type: "arena", message: `Speler ${id} verwijderd uit arena` });

  sortPlayers();
  emitArena();
}

export async function arenaClear() {
  emitLog({ type: "system", message: `Arena volledig geleegd` });

  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.isRunning = false;

  await recomputePositions();
  emitArena();
}

// ============================================================================
// SAFE ADD (Ronde score: visual only)
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number) {
  if (arena.status !== "active") return;

  const p = arena.players.find(p => p.id === id);
  if (!p) return;

  p.diamonds += Number(amount);

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
    arena.players.some(p => p.positionStatus === "elimination")
  ) {
    emitLog({
      type: "error",
      message: `Kan geen ronde starten: pending eliminaties`
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

  for (const p of arena.players) p.diamonds = 0;

  emitLog({
    type: "arena",
    message: `Ronde gestart (#${arena.round}) type: ${type}`
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
        message: `Grace gestart (${arena.settings.graceSeconds}s)`
      });

      await recomputePositions();
      emitArena();

      io.emit("round:grace", {
        round: arena.round,
        grace: arena.settings.graceSeconds
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

export async function endRound() {
  await recomputePositions();

  const pending = arena.players.filter(
    p => p.positionStatus === "elimination"
  );

  if (arena.settings.forceEliminations && pending.length > 0) {
    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;

    emitArena();

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: pending.map(p => p.id),
      top3: await getTopPlayers(3),
    });

    return;
  }

  arena.status = "idle";
  arena.isRunning = false;
  arena.timeLeft = 0;

  emitLog({
    type: "arena",
    message: `Ronde afgerond (#${arena.round})`
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
  const gameId = (io as any)?.currentGameId;
  if (!gameId) return [];

  const arr = [];

  for (const p of arena.players) {
    const total = await getFinaleScore(gameId, p.id);
    arr.push({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: total,
    });
  }

  return arr.sort((a, b) => b.diamonds - a.diamonds).slice(0, n);
}

// ============================================================================
// SNAPSHOT EXPORT
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
  } catch {}
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
    message: "Arena Engine v14 geladen (Gifts-Only Architecture)"
  });
}
