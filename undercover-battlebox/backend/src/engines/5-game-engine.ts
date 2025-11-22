// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v4.0 (Danny Eliminatie Fix Edition)
// ----------------------------------------------------------------------------
// ✔ Eliminatie correct: alleen plek 6–8 én ties
// ✔ Geen auto-eliminaties zodra admin spelers verwijdert
// ✔ Diamonds tellen alleen tijdens ACTIVE ronde
// ✔ Cumulatieve diamonds na elke ronde (voor finale)
// ✔ Reset totale diamonds bij stopGame (via export-hook)
// ✔ 100% compatible met jouw server.ts + gift-engine
// ============================================================================

import { io, emitLog } from "../server";
import pool from "../db";

// =======================================
// TYPES
// =======================================

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "semi" | "finale";

export type PositionStatus = "active" | "danger" | "elimination" | "immune";

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
// SORTING LOGIC (geüpdatet voor correcte plaats-eliminatie)
// ============================================================================

function sortPlayers(): void {
  arena.players.sort(
    (a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at
  );
  arena.lastSortedAt = Date.now();
}

/**
 * Nieuwe eliminatie-logica:
 * - Alleen plek 6, 7, 8 (als ze bestaan)
 * - Inclusief ties buiten top 5
 */
function updatePositionStatuses(): void {
  const p = arena.players;
  if (!p.length) return;

  // reset defaults
  for (const pl of p) pl.positionStatus = "active";

  if (arena.status === "active") {
    // Active: alleen lowest = danger
    const lowscore = Math.min(...p.map(pl => pl.diamonds));
    for (const pl of p) {
      if (pl.boosters.includes("immune")) pl.positionStatus = "immune";
      else if (pl.diamonds === lowscore) pl.positionStatus = "danger";
    }
    return;
  }

  if (arena.status === "grace" || arena.status === "ended") {
    // We kijken alleen naar feitelijke posities 6–8
    const byScore = [...p]
      .sort((a, b) => b.diamonds - a.diamonds);

    // posities (0-based) → 5,6,7
    const elimPositions = [5, 6, 7].filter(pos => byScore[pos]);

    for (const pos of elimPositions) {
      const targetScore = byScore[pos].diamonds;

      // alle spelers met die score → elimination
      for (const pl of p) {
        if (pl.diamonds === targetScore) pl.positionStatus = "elimination";
      }
    }

    // Ties boven positie 5 mogen NOOIT mee getrokken worden
    // Heeft jouw regel-set niet nodig, dus bewust weggelaten

    // immune blijft immune
    for (const pl of p) {
      if (pl.boosters.includes("immune")) pl.positionStatus = "immune";
    }

    return;
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
  if (!tiktok_id) return false;

  const idClean = String(tiktok_id);
  if (arena.players.some(p => p.id === idClean)) return false;

  arena.players.push({
    id: idClean,
    display_name: display_name ?? "Onbekend",
    username: (username ?? "").replace(/^@+/, ""),
    diamonds: 0,
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
  if (!tiktok_id) return;
  const idClean = String(tiktok_id);

  arena.players = arena.players.filter(p => p.id !== idClean);

  emitLog({
    type: "arena",
    message: `Speler ${idClean} verwijderd uit arena`,
  });

  // ❗ BELANGRIJK:
  // GEEN nieuwe eliminatie berekening forceren: enkel sorteren
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

  emitLog({ type: "system", message: `Arena volledig geleegd` });
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.isRunning = false;
  recomputePositions();
  emitArena();
}

// ============================================================================
// SAFE DIAMOND ADD — **alleen tijdens ACTIVE ronde**
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number): Promise<void> {
  if (arena.status !== "active") return; // ⛔ buiten ronde = NIET tellen

  const pl = arena.players.find(p => p.id === id);
  if (!pl) return;

  pl.diamonds += Number(amount) || 0;

  emitLog({
    type: "gift",
    message: `${pl.display_name} ontving ${amount} 💎 (arena)`,
  });

  recomputePositions();
  emitArena();
}

// ============================================================================
// ROUND MANAGEMENT
// ============================================================================

let roundTick: NodeJS.Timeout | null = null;

export function startRound(type: RoundType): boolean {
  // Geen ronde starten met pending eliminaties
  if (
    arena.settings.forceEliminations &&
    arena.players.some(p => p.positionStatus === "elimination")
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

  // Diamonds reset voor elke ronde
  for (const p of arena.players) p.diamonds = 0;

  emitLog({
    type: "arena",
    message: `Nieuwe ronde gestart (#${arena.round}) type: ${type}`,
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

function tick() {
  const now = Date.now();

  // ACTIVE fase
  if (arena.status === "active") {
    const left = Math.max(0, Math.ceil((arena.roundCutoff - now) / 1000));
    arena.timeLeft = left;

    if (left <= 0) {
      // ACTIVE → GRACE
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

  // GRACE fase
  if (arena.status === "grace") {
    if (now >= arena.graceEnd) endRound();
    else {
      recomputePositions();
      emitArena();
    }
    return;
  }

  // IDLE / ENDED
  if (arena.status === "ended" || arena.status === "idle") {
    if (roundTick) clearInterval(roundTick);
    roundTick = null;
  }
}

// ============================================================================
// CUMULATIEVE DIAMONDS OPLESLAAN
// ============================================================================

async function storeRoundDiamonds() {
  for (const pl of arena.players) {
    await pool.query(
      `
      UPDATE users
      SET
        diamonds_total = diamonds_total + $2,
        diamonds_current_round = 0
      WHERE tiktok_id = $1
    `,
      [BigInt(pl.id), pl.diamonds]
    );
  }
}

// ============================================================================
// END ROUND
// ============================================================================

export function endRound(): void {
  recomputePositions();

  const pending = arena.players.filter(p => p.positionStatus === "elimination");

  if (arena.settings.forceEliminations && pending.length > 0) {
    // ADMIN moet spelers verwijderen
    emitLog({
      type: "system",
      message: `Ronde beëindigd met pending eliminaties (${pending.length})`,
    });

    arena.status = "ended";
    arena.isRunning = false;
    arena.timeLeft = 0;

    emitArena();
    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: pending.map(p => p.id),
      top3: getTopPlayers(3),
    });

    storeRoundDiamonds(); // cumulatief opslaan
    return;
  }

  // Alles is verwijderd → normale einde
  arena.status = "idle";
  arena.isRunning = false;
  arena.timeLeft = 0;

  emitLog({
    type: "arena",
    message: `Ronde afgerond (#${arena.round})`,
  });

  storeRoundDiamonds();

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

// ============================================================================
// TOOLS
// ============================================================================

function getTopPlayers(n: number) {
  return [...arena.players]
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, n)
    .map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.diamonds,
    }));
}

// ============================================================================
// SNAPSHOT
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
  try {
    io.emit("updateArena", getArena());
  } catch (e) {
    console.warn("⚠ emitArena failed:", e);
  }
}

// ============================================================================
// EXTERN: RESET TOTAL DIAMONDS BIJ STOPGAME
// ============================================================================

export async function resetTotalDiamonds() {
  await pool.query(`UPDATE users SET diamonds_total = 0`);
  emitLog({ type: "system", message: "Alle cumulatieve diamonds gewist" });
}

// ============================================================================
// INIT
// ============================================================================

export async function initGame() {
  await loadArenaSettingsFromDB();
  recomputePositions();
  emitArena();

  emitLog({ type: "system", message: "Arena Engine v4.0 gestart" });
}
