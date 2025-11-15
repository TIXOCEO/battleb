// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.4 (OPTIE C — PRODUCTION SAFE)
// Unlimited spelers, tie-groups, danger, elimination, force mode
// Immunity type bestaat maar wordt nooit gebruikt
// getArena() is PURE en veroorzaakt NOOIT side-effects
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
  | "immune"; // ← bestaat, maar wordt niet toegewezen

interface Player {
  id: string;
  display_name: string;
  username: string;
  diamonds: number;
  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;
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

  positionMap: Record<string, PositionStatus>;
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
  positionMap: {},
};

// ============================================================================
// INTERNAL MUTATION HELPERS (NO SIDE EFFECTS OUTSIDE)
// ============================================================================

function _sortPlayers() {
  arena.players.sort(
    (a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at
  );
  arena.lastSortedAt = Date.now();
}

function _recomputePositionMap() {
  const p = arena.players;
  const map: Record<string, PositionStatus> = {};

  if (p.length === 0) {
    arena.positionMap = {};
    return;
  }

  // --- Tie groups ---
  const groups: { diamonds: number; members: Player[] }[] = [];
  let current: Player[] = [p[0]];

  for (let i = 1; i < p.length; i++) {
    if (p[i].diamonds === p[i - 1].diamonds) current.push(p[i]);
    else {
      groups.push({ diamonds: current[0].diamonds, members: [...current] });
      current = [p[i]];
    }
  }
  groups.push({ diamonds: current[0].diamonds, members: [...current] });

  const lastGroup = groups[groups.length - 1];

  const endangered = new Set<string>();
  const doomed = new Set<string>();

  if (arena.status === "active") {
    lastGroup.members.forEach(pl => endangered.add(pl.id));
  } else if (arena.status === "grace" || arena.status === "ended") {
    lastGroup.members.forEach(pl => doomed.add(pl.id));
  }

  for (const pl of p) {
    if (doomed.has(pl.id)) map[pl.id] = "elimination";
    else if (endangered.has(pl.id)) map[pl.id] = "danger";
    else map[pl.id] = "active";
  }

  arena.positionMap = map;
}

/**
 * SAFE mutation wrapper — ONLY mutates local state
 * NEVER calls emitArena()
 * NEVER calls getArena()
 */
function mutate(mutator: () => void) {
  mutator();
  _sortPlayers();
  _recomputePositionMap();
}

// ============================================================================
// SETTINGS – LOAD + SAVE
// ============================================================================

async function loadArenaSettingsFromDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const { rows } = await pool.query(`
    SELECT key, value FROM settings
    WHERE key IN ('roundDurationPre','roundDurationFinal','graceSeconds','forceEliminations')
  `);

  const map = new Map(rows.map((r: any) => [r.key, r.value]));

  mutate(() => {
    arena.settings = {
      roundDurationPre: Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre),
      roundDurationFinal: Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal),
      graceSeconds: Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds),
      forceEliminations: (map.get("forceEliminations") ?? "true") === "true",
    };
  });
}

export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  mutate(() => {
    arena.settings = { ...arena.settings, ...s };
  });

  const rows: [string, string][] = [
    ["roundDurationPre", String(arena.settings.roundDurationPre)],
    ["roundDurationFinal", String(arena.settings.roundDurationFinal)],
    ["graceSeconds", String(arena.settings.graceSeconds)],
    ["forceEliminations", arena.settings.forceEliminations ? "true" : "false"],
  ];

  for (const [k, v] of rows) {
    await pool.query(
      `INSERT INTO settings(key,value)
       VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [k, v]
    );
  }

  emitArena();
}

export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ============================================================================
// PLAYER MANAGEMENT
// ============================================================================

export function arenaJoin(id: string, display_name: string, username: string) {
  if (arena.players.some(p => p.id === id)) return false;

  mutate(() => {
    arena.players.push({
      id,
      display_name,
      username,
      diamonds: 0,
      boosters: [],
      status: "alive",
      joined_at: Date.now(),
    });
  });

  emitArena();
  return true;
}

export function arenaLeave(id: string) {
  mutate(() => {
    arena.players = arena.players.filter(p => p.id !== id);
  });

  emitArena();
}

// ============================================================================
// SAFE DIAMOND ADD
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number) {
  mutate(() => {
    const pl = arena.players.find(p => p.id === id);
    if (pl) pl.diamonds += Number(amount);
  });

  emitArena();
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

let roundTick: NodeJS.Timeout | null = null;

function getDurationFor(type: RoundType) {
  return type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;
}

export function startRound(type: RoundType) {
  if (arena.settings.forceEliminations &&
      Object.values(arena.positionMap).includes("elimination")) {
    return false;
  }

  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length === 0) return false;

  mutate(() => {
    arena.round += 1;
    arena.type = type;

    const secs = getDurationFor(type);
    arena.timeLeft = secs;
    arena.status = "active";
    arena.isRunning = true;

    arena.roundStartTime = Date.now();
    arena.roundCutoff = arena.roundStartTime + secs * 1000;
    arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

    arena.players.forEach(p => (p.diamonds = 0));
  });

  emitArena();

  io.emit("round:start", {
    round: arena.round,
    type: arena.type,
    duration: arena.timeLeft,
  });

  if (roundTick) clearInterval(roundTick);

  roundTick = setInterval(() => {
    const now = Date.now();

    if (arena.status === "active") {
      mutate(() => {
        arena.timeLeft = Math.max(
          0,
          Math.ceil((arena.roundCutoff - now) / 1000)
        );

        if (arena.timeLeft <= 0) {
          arena.status = "grace";
          arena.isRunning = false;
        }
      });

      emitArena();

      if (arena.status === "grace") {
        io.emit("round:grace", {
          round: arena.round,
          grace: arena.settings.graceSeconds,
        });
      }

      return;
    }

    if (arena.status === "grace") {
      if (now >= arena.graceEnd) {
        endRound();
      } else {
        mutate(() => {});
        emitArena();
      }
      return;
    }

    if (arena.status === "ended" || arena.status === "idle") {
      clearInterval(roundTick!);
      roundTick = null;
    }
  }, 1000);

  return true;
}

export function endRound() {
  let doomedIds: string[] = [];

  if (arena.settings.forceEliminations) {
    doomedIds = Object.entries(arena.positionMap)
      .filter(([_, s]) => s === "elimination")
      .map(([id]) => id);

    if (doomedIds.length > 0) {
      mutate(() => {
        arena.status = "ended";
        arena.isRunning = false;
        arena.timeLeft = 0;
      });

      emitArena();

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        top3: getTop3(),
        pendingEliminations: doomedIds,
      });

      return;
    }
  }

  mutate(() => {
    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;
  });

  emitArena();

  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    top3: getTop3(),
    pendingEliminations: [],
  });
}

function getTop3() {
  return [...arena.players].slice(0, 3).map(p => ({
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    diamonds: p.diamonds,
  }));
}

// ============================================================================
// PURE SNAPSHOT (NO SIDE EFFECTS)
// ============================================================================

export function getArena() {
  return {
    players: arena.players.map(p => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username.replace(/^@+/, ""),
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status,
      positionStatus: arena.positionMap[p.id] ?? "active",
    })),
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
// EMIT (NO SIDE EFFECTS)
// ============================================================================

export function emitArena() {
  io.emit("updateArena", getArena());
}

// ============================================================================
// INIT
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  mutate(() => {});
  emitArena();
}
