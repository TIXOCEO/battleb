// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v2.1 FINAL
// Ondersteunt: unlimited spelers, tie-groups, danger, elimination, force mode
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
  diamonds: number;      // huidige ronde
  boosters: string[];
  status: "alive" | "eliminated";
  joined_at: number;     // voor sorteervolgorde bij ties
}

interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean; // NEW
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

  const pre  = Number(map.get("roundDurationPre")  ?? DEFAULT_SETTINGS.roundDurationPre);
  const fin  = Number(map.get("roundDurationFinal") ?? DEFAULT_SETTINGS.roundDurationFinal);
  const grace = Number(map.get("graceSeconds") ?? DEFAULT_SETTINGS.graceSeconds);
  const force = (map.get("forceEliminations") ?? "true") === "true";

  arena.settings = {
    roundDurationPre: pre > 0 ? pre : DEFAULT_SETTINGS.roundDurationPre,
    roundDurationFinal: fin > 0 ? fin : DEFAULT_SETTINGS.roundDurationFinal,
    graceSeconds: grace >= 0 ? grace : DEFAULT_SETTINGS.graceSeconds,
    forceEliminations: force,
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
    await pool.query(`
      INSERT INTO settings(key,value)
      VALUES ($1,$2)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    `, [k, v]);
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
  updatePositionStatuses();
}

// =======================================
// 🔥 TIE-GROUP LOGICA
// =======================================
//
// - Alle spelers met dezelfde diamonds horen bij dezelfde group
// - Danger = laatste tie-groep in active fase
// - Elimination = laatste tie-groep in grace/ended
// - Immune blijft top3 (ongeacht tie)
// =======================================

function updatePositionStatuses(): void {
  const p = arena.players;
  const map: Record<string, PositionStatus> = {};

  if (p.length === 0) {
    arena.positionMap = {};
    return;
  }

  // ▼ 1. Identificeer alle tie groups
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

  // ▼ 2. Bepaal top3 (immune) — op basis van posities, niet op groups
  const immuneIds = p.slice(0, 3).map(pl => pl.id);

  // ▼ 3. Welke group is "onderste"?
  const lastGroup = groups[groups.length - 1];

  // ▼ 4. Active fase = danger op laatste group
  // ▼    Grace/Ended = elimination op laatste group
  let endangered = new Set<string>();
  let doomed = new Set<string>();

  if (arena.status === "active") {
    // alleen danger
    lastGroup.members.forEach(pl => endangered.add(pl.id));
  } else if (arena.status === "grace" || arena.status === "ended") {
    // elimination
    lastGroup.members.forEach(pl => doomed.add(pl.id));
  }

  // ▼ 5. Toewijzen
  for (const pl of p) {
    if (immuneIds.includes(pl.id)) {
      map[pl.id] = "immune";
    } else if (doomed.has(pl.id)) {
      map[pl.id] = "elimination";
    } else if (endangered.has(pl.id)) {
      map[pl.id] = "danger";
    } else {
      map[pl.id] = "active";
    }
  }

  arena.positionMap = map;
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
    username,
    diamonds: 0,
    boosters: [],
    status: "alive",
    joined_at: Date.now(),
  };

  arena.players.push(pl);
  sortPlayers();
  emitArena();
  return true;
}

export function arenaLeave(tiktok_id: string): void {
  const idx = arena.players.findIndex(p => p.id === tiktok_id);
  if (idx === -1) return;

  arena.players.splice(idx, 1);
  sortPlayers();
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

  sortPlayers();
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
  // BLOCK: Force eliminations staan aan → maar er zijn nog spelers met elimination
  if (arena.settings.forceEliminations) {
    const eliminationExists = Object.values(arena.positionMap).includes("elimination");
    if (eliminationExists) {
      // Admin moet eerst mensen wegklikken
      return false;
    }
  }

  if (arena.status === "active" || arena.status === "grace") return false;
  if (arena.players.length < 1) return false;

  // increment ronde
  arena.round += 1;
  arena.type = type;

  // tijden
  const secs = getDurationForType(type);
  arena.timeLeft = secs;
  arena.status = "active";
  arena.isRunning = true;

  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + secs * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  // reset ronde diamonds
  for (const pl of arena.players) {
    pl.diamonds = 0;
  }

  sortPlayers();
  emitArena();

  io.emit("round:start", {
    round: arena.round,
    type: arena.type,
    duration: secs,
  });

  if (roundTick) clearInterval(roundTick);

  roundTick = setInterval(() => {
    const now = Date.now();

    // ACTIVE fase
    if (arena.status === "active") {
      const left = Math.max(0, Math.ceil((arena.roundCutoff - now) / 1000));
      arena.timeLeft = left;

      if (left <= 0) {
        // naar grace
        arena.status = "grace";
        arena.isRunning = false;
        arena.timeLeft = 0;

        updatePositionStatuses(); // laatste tie-group wordt elimination
        emitArena();

        io.emit("round:grace", {
          round: arena.round,
          grace: arena.settings.graceSeconds,
        });
      } else {
        updatePositionStatuses();
        emitArena();
      }
      return;
    }

    // GRACE fase
    if (arena.status === "grace") {
      if (now >= arena.graceEnd) {
        endRound();
      } else {
        updatePositionStatuses();
        emitArena();
      }
      return;
    }

    // EINDE → interval stoppen
    if (arena.status === "ended" || arena.status === "idle") {
      if (roundTick) clearInterval(roundTick);
      roundTick = null;
    }
  }, 1000);

  return true;
}

export function endRound(): void {
  // 1) Check forceEliminations
  if (arena.settings.forceEliminations) {
    const doomed = Object.entries(arena.positionMap)
      .filter(([_, s]) => s === "elimination")
      .map(([id]) => id);

    if (doomed.length > 0) {
      // ronde eindigt, maar admin MOET nog elimineren
      arena.status = "ended";
      arena.isRunning = false;
      arena.timeLeft = 0;

      updatePositionStatuses();
      emitArena();

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        top3: getTop3(),
        pendingEliminations: doomed,
      });

      return; // game blijft locked tot admin wegklikt
    }
  }

  // 2) normaal einde
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
  // veilig slice (minder dan 3 spelers)
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

export function emitArena() {
  io.emit("updateArena", getArena());
}

// ============================================================================
// INIT GAME
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  sortPlayers();
  updatePositionStatuses();
  emitArena();
}
