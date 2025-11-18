// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.5 (Danny Stable, Twist-Ready)
// ----------------------------------------------------------------------------
// - Unlimited spelers
// - Danger/elimination werkt alleen bij actieve of grace fase
// - Immunity override werkt via boosters
// - UI sync: live statuses blijven consistent
// - Idle-fase toont ALLE spelers als "active"
// ============================================================================

import { io } from "../server";
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

  if (arena.status === "idle") {
    // In idle, iedereen actief
    for (const pl of p) {
      pl.positionStatus = pl.boosters.includes("immune") ? "immune" : "active";
    }
    return;
  }

  const groups: { diamonds: number; members: Player[] }[] = [];
  let batch: Player[] = [p[0]];

  for (let i = 1; i < p.length; i++) {
    if (p[i].diamonds === p[i - 1].diamonds) {
      batch.push(p[i]);
    } else {
      groups.push({ diamonds: batch[0].diamonds, members: [...batch] });
      batch = [p[i]];
    }
  }
  groups.push({ diamonds: batch[0].diamonds, members: [...batch] });

  const lastGroup = groups[groups.length - 1];
  const endangered = new Set<string>();
  const doomed = new Set<string>();

  if (arena.status === "active") {
    lastGroup.members.forEach(pl => endangered.add(pl.id));
  }

  if (arena.status === "grace" || arena.status === "ended") {
    lastGroup.members.forEach(pl => doomed.add(pl.id));
  }

  for (const pl of p) {
    let status: PositionStatus = "active";

    if (doomed.has(pl.id)) status = "elimination";
    else if (endangered.has(pl.id)) status = "danger";

    if (pl.boosters.includes("immune")) {
      status = "immune";
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
  recomputePositions();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string): void {
  arena.players = arena.players.filter(p => p.id !== tiktok_id);
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
    return false;
  }

  if (arena.status === "active" || arena.status === "grace") return false;
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

  arena.players.forEach(pl => (pl.diamonds = 0));

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
  if (arena.settings.forceEliminations) {
    const doomed = arena.players
      .filter(p => p.positionStatus === "elimination")
      .map(p => p.id);

    if (doomed.length > 0) {
      arena.status = "ended";
      arena.isRunning = false;
      arena.timeLeft = 0;

      emitArena();
      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: doomed,
      });
      return;
    }
  }

  arena.status = "ended";
  arena.isRunning = false;
  arena.timeLeft = 0;

  emitArena();
  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    pendingEliminations: [],
  });

  if (roundTick) clearInterval(roundTick);
  roundTick = null;
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
