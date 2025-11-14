// ARENA ENGINE – v2.0 with position statuses + elimination enforcement

import { io } from "../server";
import pool from "../db";
import { addDiamonds } from "./4-points-engine";

// === Types ===
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
  diamonds: number; // diamonds binnen de HUIDIGE ronde
  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;
}

interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;

  // NEW
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

  // NEW
  positionMap: Record<string, PositionStatus>;
}

// === Default settings ===

const DEFAULT_SETTINGS: ArenaSettings = {
  roundDurationPre: 180,
  roundDurationFinal: 300,
  graceSeconds: 5,
  forceEliminations: true,
};

// === Internal arena state ===

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

// ===============================================================
// SETTINGS DB
// ===============================================================

async function loadArenaSettingsFromDB(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const { rows } = await pool.query(
    `SELECT key, value
     FROM settings
     WHERE key IN (
       'roundDurationPre',
       'roundDurationFinal',
       'graceSeconds',
       'forceEliminations'
     )`
  );

  const map = new Map(rows.map((r: any) => [r.key, r.value]));

  const pre = Number(map.get("roundDurationPre") ?? DEFAULT_SETTINGS.roundDurationPre);
  const fin = Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal);
  const grace = Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds);
  const force = map.get("forceEliminations") === "false" ? false : true;

  arena.settings = {
    roundDurationPre: pre > 0 ? pre : DEFAULT_SETTINGS.roundDurationPre,
    roundDurationFinal: fin > 0 ? fin : DEFAULT_SETTINGS.roundDurationFinal,
    graceSeconds: grace >= 0 ? grace : DEFAULT_SETTINGS.graceSeconds,
    forceEliminations: force,
  };
}

async function saveArenaSettingsToDB(s: Partial<ArenaSettings>): Promise<void> {
  const merged: ArenaSettings = { ...arena.settings, ...s };
  arena.settings = merged;

  const pairs: [string, string][] = [
    ["roundDurationPre", String(merged.roundDurationPre)],
    ["roundDurationFinal", String(merged.roundDurationFinal)],
    ["graceSeconds", String(merged.graceSeconds)],
    ["forceEliminations", merged.forceEliminations ? "true" : "false"],
  ];

  for (const [key, value] of pairs) {
    await pool.query(
      `INSERT INTO settings(key, value)
       VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }

  emitArena();
}

// Public API
export async function updateArenaSettings(s: Partial<ArenaSettings>) {
  await saveArenaSettingsToDB(s);
}
export function getArenaSettings(): ArenaSettings {
  return { ...arena.settings };
}

// ===============================================================
// PLAYER MANAGEMENT
// ===============================================================

function sortPlayers(): void {
  arena.players.sort(
    (a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at
  );
  arena.lastSortedAt = Date.now();
  updatePositionStatuses();
}

// NEW — assign correct status based on ranking
function updatePositionStatuses(): void {
  const map: Record<string, PositionStatus> = {};

  const players = arena.players;

  players.forEach((p, idx) => {
    const pos = idx + 1;

    // immune = top 3
    if (pos <= 3) {
      map[p.id] = "immune";
      return;
    }

    // danger = pos 6/7/8
    if (players.length >= 6 && pos >= 6) {
      map[p.id] = "danger";
      return;
    }

    // default middle = active
    map[p.id] = "active";
  });

  // if round is ended, promote danger → elimination
  if (arena.status === "grace" || arena.status === "ended") {
    players.forEach((p, idx) => {
      const pos = idx + 1;

      // bottom 3 MUST become elimination
      if (players.length >= 6 && pos >= 6) {
        map[p.id] = "elimination";
      }
    });
  }

  arena.positionMap = map;
}

export function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string,
  source: "queue" | "guest" | "admin" = "queue"
): boolean {
  if (arena.players.length >= 8) return false;
  if (arena.players.some((p) => p.id === tiktok_id)) return false;

  const p: Player = {
    id: tiktok_id,
    display_name,
    username,
    diamonds: 0,
    boosters: [],
    status: "alive",
    joined_at: Date.now(),
  };

  arena.players.push(p);
  sortPlayers();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string): void {
  const idx = arena.players.findIndex((p) => p.id === tiktok_id);
  if (idx === -1) return;
  arena.players.splice(idx, 1);
  sortPlayers();
  emitArena();
}

export async function arenaClear(): Promise<void> {
  for (const p of arena.players) {
    await pool.query(
      `UPDATE users SET diamonds_current_round = 0 WHERE tiktok_id = $1`,
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

  sortPlayers();
  emitArena();
}

// ===============================================================
// ROUND MANAGEMENT
// ===============================================================

let roundTick: NodeJS.Timeout | null = null;

function getDurationForType(type: RoundType): number {
  return type === "finale"
    ? arena.settings.roundDurationFinal
    : arena.settings.roundDurationPre;
}

export function startRound(type: RoundType): boolean {
  // mag niet starten als eliminaties nodig zijn + forceEliminations aan staat
  if (
    arena.settings.forceEliminations &&
    arena.positionMap &&
    Object.values(arena.positionMap).includes("elimination")
  ) {
    // als er al spelers zijn die geëlimineerd MOETEN worden volgens ranking
    return false;
  }

  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length < 2) return false;

  arena.round += 1;
  arena.type = type;

  const totalSecs = getDurationForType(type);

  arena.timeLeft = totalSecs;
  arena.isRunning = true;
  arena.status = "active";
  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + totalSecs * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  // Reset ronde-diamonds
  for (const p of arena.players) p.diamonds = 0;

  sortPlayers();
  emitArena();

  io.emit("round:start", {
    round: arena.round,
    type: arena.type,
    duration: totalSecs,
  });

  if (roundTick) clearInterval(roundTick);

  roundTick = setInterval(() => {
    const now = Date.now();

    // ACTIVE → countdown
    if (arena.status === "active") {
      const left = Math.max(0, Math.ceil((arena.roundCutoff - now) / 1000));
      arena.timeLeft = left;

      if (left <= 0) {
        // Naar grace
        arena.status = "grace";
        arena.isRunning = false;
        arena.timeLeft = 0;

        updatePositionStatuses(); // bottom 3 → elimination
        emitArena();
        io.emit("round:grace", {
          round: arena.round,
          grace: arena.settings.graceSeconds,
        });
      } else {
        emitArena();
      }
      return;
    }

    // GRACE → einde
    if (arena.status === "grace") {
      if (now >= arena.graceEnd) {
        endRound();
      } else {
        updatePositionStatuses();
        emitArena();
      }
      return;
    }

    // END/IDLE → cleanup interval
    if (arena.status === "ended" || arena.status === "idle") {
      if (roundTick) clearInterval(roundTick);
      roundTick = null;
    }
  }, 1000);

  return true;
}

export function endRound(): void {
  // force eliminations check
  if (arena.settings.forceEliminations) {
    const mustEliminate = Object.entries(arena.positionMap)
      .filter(([_, status]) => status === "elimination")
      .map(([id]) => id);

    if (mustEliminate.length > 0) {
      // Ronde mag NIET eindigen totdat admin deze spelers verwijdert
      // We zetten de status wél op ended, maar keeplocked
      arena.status = "ended";
      arena.isRunning = false;
      arena.timeLeft = 0;

      updatePositionStatuses();
      emitArena();

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        top3: getTop3(),
        pendingEliminations: mustEliminate,
      });

      return;
    }
  }

  // normale end
  arena.status = "ended";
  arena.isRunning = false;
  arena.timeLeft = 0;

  updatePositionStatuses();
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

// ===============================================================
// SNAPSHOT
// ===============================================================

export function getArena() {
  sortPlayers();
  updatePositionStatuses();

  return {
    players: arena.players.map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username.replace(/^@+/, ""),
      diamonds: p.diamonds,
      boosters: p.boosters,
      status: p.status,

      // NEW: positie status
      positionStatus: arena.positionMap[p.id] || "active",
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

export function emitArena() {
  io.emit("updateArena", getArena());
}

// ===============================================================
// INIT GAME
// ===============================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  sortPlayers();
  updatePositionStatuses();
  emitArena();
}
