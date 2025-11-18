// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.9 (Danny Ultra Stable, Twist-Ready)
// ----------------------------------------------------------------------------
// ENHANCEMENTS:
// - Position logic: Only the bottom group is danger (in quarter)
// - Fix for wrong #2 dangerAssignment
// - Full pause on pending eliminations (forceEliminations)
// - Twist-compatible with boosters, immune, and dynamic position updates
// - Integrated logs + arena emit for real-time dashboard
// ============================================================================

import { io, emitLog } from "../server";
import pool from "../db";

// =======================================
// TYPES
// =======================================

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "semi" | "finale";

export type PositionStatus =
  | "active"
  | "danger"
  | "elimination"
  | "immune";

interface Player {
  id: string;
  display_name: string;
  username: string;
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
// SETTINGS – LOAD + SAVE
// ============================================================================

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
// SORTING + POSITION STATUS
// ============================================================================

function sortPlayers(): void {
  arena.players.sort(
    (a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at
  );
  arena.lastSortedAt = Date.now();
}

function updatePositionStatuses(): void {
  const p = arena.players;
  if (!p.length) return;

  // Only bottom group is danger (quarter), elimination in grace
  const scores = [...new Set(p.map(pl => pl.diamonds))].sort((a, b) => b - a);
  const lowest = scores[scores.length - 1];

  for (const pl of p) {
    let status: PositionStatus = "active";

    if (pl.boosters.includes("immune")) {
      status = "immune";
    } else if (arena.status === "active" && pl.diamonds === lowest) {
      status = "danger";
    } else if (
      (arena.status === "grace" || arena.status === "ended") &&
      pl.diamonds === lowest
    ) {
      status = "elimination";
    }

    pl.positionStatus = status;
  }
}

function recomputePositions(): void {
  sortPlayers();
  updatePositionStatuses();
}

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string
): boolean {
  if (arena.players.some(p => p.id === tiktok_id)) return false;

  const pl: Player = {
    id: tiktok_id,
    display_name,
    username: username.replace(/^@+/, ""),
    diamonds: 0,
    boosters: [],
    status: "alive",
    joined_at: Date.now(),
    positionStatus: "active",
  };

  arena.players.push(pl);
  emitLog({ type: "arena", message: `${display_name} toegevoegd aan arena` });
  recomputePositions();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string): void {
  arena.players = arena.players.filter(p => p.id !== tiktok_id);
  emitLog({ type: "arena", message: `Speler ${tiktok_id} verlaten arena` });
  recomputePositions();
  emitArena();
}

export async function arenaClear(): Promise<void> {
  for (const p of arena.players) {
    await pool.query(
      `UPDATE users SET diamonds_current_round = 0 WHERE tiktok_id=$1`,
      [BigInt(p.id)]
    );
  }

  emitLog({ type: "system", message: `Arena volledig geleegd` });
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.isRunning = false;
  recomputePositions();
  emitArena();
}

// ============================================================================
// SAFE DIAMOND ADD
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number): Promise<void> {
  const pl = arena.players.find(p => p.id === id);
  if (!pl) return;

  pl.diamonds += Number(amount);
  emitLog({ type: "gift", message: `${pl.display_name} ontving ${amount} 💎 (arena)` });
  recomputePositions();
  emitArena();
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

let roundTick: NodeJS.Timeout | null = null;

export function startRound(type: RoundType): boolean {
  if (arena.settings.forceEliminations &&
      arena.players.some(p => p.positionStatus === "elimination")) {
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

  const duration = type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;

  arena.status = "active";
  arena.isRunning = true;
  arena.timeLeft = duration;

  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + duration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  for (const p of arena.players) {
    p.diamonds = 0;
  }

  emitLog({
    type: "arena",
    message: `Nieuwe ronde gestart (#${arena.round}) type: ${type}`,
  });

  recomputePositions();
  emitArena();
  io.emit("round:start", { round: arena.round, type, duration });

  if (roundTick) clearInterval(roundTick);
  roundTick = setInterval(tick, 1000);

  return true;
}

function tick() {
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
        message: `Grace-periode (${arena.settings.graceSeconds}s) gestart`,
      });

      recomputePositions();
      emitArena();
      io.emit("round:grace", {
        round: arena.round,
        grace: arena.settings.graceSeconds,
      });
    } else {
      recomputePositions();
      emitArena();
    }
    return;
  }

  if (arena.status === "grace") {
    if (now >= arena.graceEnd) {
      endRound();
    } else {
      recomputePositions();
      emitArena();
    }
    return;
  }

  if (arena.status === "ended" || arena.status === "idle") {
    if (roundTick) clearInterval(roundTick);
    roundTick = null;
  }
}

export function endRound(): void {
  const doomed = arena.players
    .filter(p => p.positionStatus === "elimination")
    .map(p => p.id);

  if (arena.settings.forceEliminations && doomed.length > 0) {
    emitLog({
      type: "system",
      message: `Ronde beëindigd met pending eliminaties (${doomed.length})`,
    });

    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;

    emitArena();
    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3: getTopPlayers(3),
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
    top3: getTopPlayers(3),
  });

  if (roundTick) clearInterval(roundTick);
  roundTick = null;
}

function getTopPlayers(n: number) {
  return [...arena.players]
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, n)
    .map(p => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds,
    }));
}

// ============================================================================
// SNAPSHOT + EMIT
// ============================================================================

export function getArena() {
  recomputePositions();

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
  io.emit("updateArena", getArena());
}

// ============================================================================
// INIT
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  recomputePositions();
  emitArena();
}
