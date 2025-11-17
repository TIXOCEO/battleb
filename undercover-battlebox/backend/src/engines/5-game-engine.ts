// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.4 TWIST-READY
// ----------------------------------------------------------------------------
// - Unlimited spelers
// - Tie-groups, danger, elimination, force mode
// - Immunity type is nu ACTIEF via boosters ("immune")
// - getArena() geeft ECHTE player-objecten terug (twist-engine kan muteren)
// - Geen recursion tussen getArena / emitArena
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
  | "immune"; // nu echt gebruikt

interface Player {
  id: string;
  display_name: string;
  username: string;             // zonder @ in arena
  diamonds: number;
  boosters: string[];           // bevat o.a. "immune"
  status: "alive" | "eliminated";
  joined_at: number;
  positionStatus?: PositionStatus; // visuele status voor UI
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

  arena.settings = {
    roundDurationPre: Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre),
    roundDurationFinal: Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal),
    graceSeconds: Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds),
    forceEliminations: (map.get("forceEliminations") ?? "true") === "true",
  };
}

async function saveArenaSettingsToDB(s: Partial<ArenaSettings>): Promise<void> {
  arena.settings = { ...arena.settings, ...s };

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

export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  await saveArenaSettingsToDB(s);
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

// POSITION LOGICA — met immunity override
function updatePositionStatuses(): void {
  const p = arena.players;
  if (p.length === 0) {
    return;
  }

  // Tie-groups bepalen o.b.v. diamonds
  const groups: { diamonds: number; members: Player[] }[] = [];
  let current: Player[] = [p[0]];

  for (let i = 1; i < p.length; i++) {
    if (p[i].diamonds === p[i - 1].diamonds) {
      current.push(p[i]);
    } else {
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
    let status: PositionStatus = "active";

    if (doomed.has(pl.id)) status = "elimination";
    else if (endangered.has(pl.id)) status = "danger";

    // Immunity override: als speler "immune" booster heeft,
    // dan tonen we deze status ongeacht danger/elimination
    if (pl.boosters.includes("immune")) {
      status = "immune";
    }

    pl.positionStatus = status;
  }
}

// ALLEEN intern: herbereken ranking + posities
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
    // in arena altijd username zonder @ voor UI & filters
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
  const idx = arena.players.findIndex(p => p.id === tiktok_id);
  if (idx === -1) return;

  arena.players.splice(idx, 1);
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
  arena.type = "quarter";
  arena.status = "idle";
  arena.timeLeft = 0;
  arena.isRunning = false;
  arena.roundStartTime = 0;
  arena.roundCutoff = 0;
  arena.graceEnd = 0;

  recomputePositions();
  emitArena();
}

// ============================================================================
// SAFE DIAMOND ADD (voor Gift Engine)
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

function getDurationForType(type: RoundType): number {
  return type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;
}

export function startRound(type: RoundType): boolean {
  // ForceEliminations: als er nog "elimination" posities zijn, niet starten
  if (arena.settings.forceEliminations) {
    const eliminationExists = arena.players.some(
      p => p.positionStatus === "elimination"
    );
    if (eliminationExists) {
      return false;
    }
  }

  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length < 1) return false;

  arena.round += 1;
  arena.type = type;

  const secs = getDurationForType(type);
  arena.timeLeft = secs;
  arena.status = "active";
  arena.isRunning = true;

  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + secs * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  for (const pl of arena.players) {
    pl.diamonds = 0;
    // status blijft "alive" — twist-engine kan status zelf togglen
  }

  recomputePositions();
  emitArena();

  io.emit("round:start", {
    round: arena.round,
    type: arena.type,
    duration: secs,
  });

  if (roundTick) clearInterval(roundTick);

  roundTick = setInterval(() => {
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
  }, 1000);

  return true;
}

// ============================================================================
// END ROUND
// ============================================================================

export function endRound(): void {
  if (arena.settings.forceEliminations) {
    // Doomed = spelers met positionStatus "elimination"
    // Immunes krijgen sowieso nooit "elimination" door override.
    const doomed = arena.players
      .filter(p => p.positionStatus === "elimination")
      .map(p => p.id);

    if (doomed.length > 0) {
      arena.status = "ended";
      arena.isRunning = false;
      arena.timeLeft = 0;

      recomputePositions();
      emitArena();

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        top3: getTop3(),
        pendingEliminations: doomed,
      });
      return;
    }
  }

  arena.status = "ended";
  arena.isRunning = false;
  arena.timeLeft = 0;

  recomputePositions();
  emitArena();

  io.emit("round:end", {
    round: arena.round,
    type: arena.type,
    top3: getTop3(),
    pendingEliminations: [],
  });

  if (roundTick) clearInterval(roundTick);
  roundTick = null;
}

function getTop3() {
  const sorted = [...arena.players];
  return sorted.slice(0, 3).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    username: p.username,
    diamonds: p.diamonds,
  }));
}

// ============================================================================
// SNAPSHOT + EMIT
// ============================================================================

/**
 * getArena()
 * ----------
 * Geeft een **live snapshot** terug:
 *  - players zijn ECHTE Player-objecten (geen clone)
 *  - twist-engine mag hierop muteren (status, boosters, order via splice)
 *  - settings, times, etc zijn read-only in praktijk
 */
export function getArena() {
  // Zorg dat ranking & positionStatus altijd up-to-date zijn
  recomputePositions();

  return {
    players: arena.players, // dezelfde array / objecten als intern
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
