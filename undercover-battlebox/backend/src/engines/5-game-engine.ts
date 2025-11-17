// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.5 (DANNY STABLE BUILD)
// ============================================================================
//
// - Unlimited spelers
// - Tie-group logic
// - Danger zone tijdens grace
// - Immune system (via twists)
// - Safe updates zonder race conditions
// - getArena() is PURE — nooit muteren
// - Compatible met twist-engine, gift-engine & admin
//
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
  | "elimination";

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
// INTERNAL HELPERS (pure mutations)
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

  // Detect tie groups
  const groups: { diamonds: number; members: Player[] }[] = [];
  let buffer: Player[] = [p[0]];

  for (let i = 1; i < p.length; i++) {
    if (p[i].diamonds === p[i - 1].diamonds) {
      buffer.push(p[i]);
    } else {
      groups.push({ diamonds: buffer[0].diamonds, members: [...buffer] });
      buffer = [p[i]];
    }
  }
  groups.push({ diamonds: buffer[0].diamonds, members: [...buffer] });

  const lastGroup = groups[groups.length - 1];
  const endangered = new Set<string>();

  // Danger = lowest tie-group ONLY during grace
  if (arena.status === "grace") {
    lastGroup.members.forEach(pl => endangered.add(pl.id));
  }

  for (const pl of p) {
    if (endangered.has(pl.id)) map[pl.id] = "danger";
    else map[pl.id] = "active";
  }

  arena.positionMap = map;
}

function mutate(fn: () => void) {
  fn();
  _sortPlayers();
  _recomputePositionMap();
}

// ============================================================================
// SETTINGS LOAD/SAVE
// ============================================================================

async function loadArenaSettingsFromDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const r = await pool.query(`
    SELECT key, value
    FROM settings
    WHERE key IN (
      'roundDurationPre','roundDurationFinal',
      'graceSeconds','forceEliminations'
    )
  `);

  const map = new Map(r.rows.map((x: any) => [x.key, x.value]));

  mutate(() => {
    arena.settings.roundDurationPre =
      Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre);

    arena.settings.roundDurationFinal =
      Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal);

    arena.settings.graceSeconds =
      Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds);

    arena.settings.forceEliminations =
      (map.get("forceEliminations") ?? "true") === "true";
  });
}

export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  mutate(() => {
    arena.settings = { ...arena.settings, ...s };
  });

  const pairs = [
    ["roundDurationPre", arena.settings.roundDurationPre],
    ["roundDurationFinal", arena.settings.roundDurationFinal],
    ["graceSeconds", arena.settings.graceSeconds],
    ["forceEliminations", arena.settings.forceEliminations ? "true" : "false"],
  ];

  for (const [k, v] of pairs) {
    await pool.query(
      `INSERT INTO settings(key,value)
       VALUES ($1,$2)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [k, String(v)]
    );
  }

  emitArena();
}

// ============================================================================
// ARENA PLAYER MANAGEMENT
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
// DIAMOND SYSTEM
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number) {
  mutate(() => {
    const p = arena.players.find(p => p.id === id);
    if (p) p.diamonds += Number(amount);
  });

  emitArena();
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

let roundTick: NodeJS.Timeout | null = null;

function getDuration(type: RoundType) {
  return type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;
}

export function startRound(type: RoundType) {
  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length === 0) return false;

  mutate(() => {
    arena.round += 1;
    arena.type = type;

    const dur = getDuration(type);
    arena.timeLeft = dur;

    arena.status = "active";
    arena.isRunning = true;

    arena.roundStartTime = Date.now();
    arena.roundCutoff = arena.roundStartTime + dur * 1000;
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

    // ACTIVE phase
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

    // GRACE phase
    if (arena.status === "grace") {
      if (now >= arena.graceEnd) {
        endRound();
      } else {
        emitArena();
      }
      return;
    }

    // Round finished
    if (arena.status === "ended" || arena.status === "idle") {
      if (roundTick) clearInterval(roundTick);
      roundTick = null;
    }
  }, 1000);

  return true;
}

// ============================================================================
// END ROUND
// ============================================================================

export function endRound() {
  const players = arena.players;

  const immuneIds = new Set(
    players.filter(p => p.boosters.includes("immune")).map(p => p.id)
  );

  // Determine doomed players
  const doomed: string[] = [];

  for (const p of players) {
    if (p.status === "eliminated") {
      if (!immuneIds.has(p.id)) doomed.push(p.id);
      continue;
    }

    const pos = arena.positionMap[p.id];

    if (pos === "danger" && !immuneIds.has(p.id)) {
      doomed.push(p.id);
    }
  }

  // Respect forceEliminations
  const finalKills = arena.settings.forceEliminations ? doomed : [];

  mutate(() => {
    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;

    for (const id of finalKills) {
      const p = arena.players.find(x => x.id === id);
      if (p) p.status = "eliminated";
    }
  });

  emitArena();

  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    top3: getTop3(),
    pendingEliminations: finalKills,
  });
}

// ============================================================================
// TOP 3
// ============================================================================

function getTop3() {
  return [...arena.players].slice(0, 3).map(p => ({
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    diamonds: p.diamonds,
  }));
}

// ============================================================================
// GET SNAPSHOT (PURE)
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
// EMIT
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
