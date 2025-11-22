// ============================================================================
// 5-GAME-ENGINE.ts — Arena Engine v4.1 (Finale Totals Edition)
// ----------------------------------------------------------------------------
// ✔ Eliminatie quarter: plek 6–8 + ties
// ✔ Eliminatie finale: laatste plek + ties
// ✔ Finale sorting = diamonds_total + diamonds_current_round
// ✔ diamonds_total bouwt op: quarter + finale
// ✔ current_round wordt na iedere ronde toegevoegd & gereset
// ✔ Immune werkt correct
// ✔ 100% compatibel met jouw gift-engine + server
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

  diamonds: number; // huidige ronde
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
// SORTING LOGIC — supports finale totals
// ============================================================================

async function getPlayerTotal(id: string): Promise<number> {
  const r = await pool.query(
    `SELECT diamonds_total FROM users WHERE tiktok_id=$1`,
    [BigInt(id)]
  );
  return Number(r.rows[0]?.diamonds_total ?? 0);
}

function sortPlayersFinale(): void {
  arena.players.sort((a, b) => {
    const aScore = (a as any)._total + a.diamonds;
    const bScore = (b as any)._total + b.diamonds;
    return bScore - aScore || a.joined_at - b.joined_at;
  });
}

function sortPlayersQuarter(): void {
  arena.players.sort(
    (a, b) => b.diamonds - a.diamonds || a.joined_at - b.joined_at
  );
}

async function sortPlayers(): Promise<void> {

  if (arena.type === "finale") {
    // load total_diamonds from DB for each player
    for (const p of arena.players) {
      const total = await getPlayerTotal(p.id);
      (p as any)._total = total; // temp value for sorting
    }
    sortPlayersFinale();
  }

  else {
    sortPlayersQuarter();
  }

  arena.lastSortedAt = Date.now();
}

/**
 * Eliminatie-logica:
 *
 * Quarter:
 *    - plek 6–8 + iedereen met dezelfde score
 *
 * Finale:
 *    - laatste plek + iedereen met dezelfde totale finale score
 */
async function updatePositionStatuses(): Promise<void> {
  const p = arena.players;
  if (!p.length) return;

  // reset
  for (const pl of p) pl.positionStatus = "active";

  if (arena.status === "active") {
    // lowest = danger
    let lowest = Infinity;

    if (arena.type === "finale") {
      lowest = Math.min(
        ...p.map(pl => (pl as any)._total + pl.diamonds)
      );
    } else {
      lowest = Math.min(...p.map(pl => pl.diamonds));
    }

    for (const pl of p) {
      const value =
        arena.type === "finale"
          ? (pl as any)._total + pl.diamonds
          : pl.diamonds;

      if (pl.boosters.includes("immune")) pl.positionStatus = "immune";
      else if (value === lowest) pl.positionStatus = "danger";
    }

    return;
  }

  // GRACE/ENDED → eliminations
  if (arena.status === "grace" || arena.status === "ended") {
    await sortPlayers();

    if (arena.type === "quarter") {
      // pos 6–8 (index 5,6,7)
      const elimPositions = [5, 6, 7].filter(i => p[i]);

      for (const pos of elimPositions) {
        const target = p[pos].diamonds;
        for (const pl of p) {
          if (pl.diamonds === target) pl.positionStatus = "elimination";
        }
      }
    }

    else if (arena.type === "finale") {
      // laatste plek
      const last = p[p.length - 1];
      const lastScore = (last as any)._total + last.diamonds;

      for (const pl of p) {
        const value = (pl as any)._total + pl.diamonds;
        if (value === lastScore) pl.positionStatus = "elimination";
      }
    }

    // immune stays immune
    for (const pl of p)
      if (pl.boosters.includes("immune")) pl.positionStatus = "immune";

    return;
  }
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

  emitLog({ type: "arena", message: `Speler ${idClean} verwijderd uit arena` });

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
// SAFE ADD DIAMONDS
// ============================================================================

export async function safeAddArenaDiamonds(id: string, amount: number): Promise<void> {
  if (arena.status !== "active") return;

  const pl = arena.players.find(p => p.id === id);
  if (!pl) return;

  pl.diamonds += Number(amount) || 0;

  emitLog({ type: "gift", message: `${pl.display_name} ontving ${amount} 💎` });

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
    emitLog({ type: "error", message: `Kan geen ronde starten: pending eliminaties` });
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

  // reset ronde diamonds
  for (const p of arena.players) p.diamonds = 0;

  emitLog({ type: "arena", message: `Ronde gestart (#${arena.round}) type: ${type}` });

  recomputePositions();
  emitArena();

  io.emit("round:start", { round: arena.round, type, duration });

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
        message: `Grace-periode (${arena.settings.graceSeconds}s) gestart`,
      });

      await recomputePositions();
      emitArena();

      io.emit("round:grace", { round: arena.round, grace: arena.settings.graceSeconds });
    } else {
      await recomputePositions();
      emitArena();
    }
    return;
  }

  if (arena.status === "grace") {
    if (now >= arena.graceEnd) endRound();
    else {
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
// STORE ROUND DIAMONDS
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

export async function endRound(): Promise<void> {
  await recomputePositions();

  const pending = arena.players.filter(p => p.positionStatus === "elimination");

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
      pendingEliminations: pending.map(p => p.id),
      top3: await getTopPlayers(3),
    });

    await storeRoundDiamonds();
    return;
  }

  // Normaal einde
  arena.status = "idle";
  arena.isRunning = false;
  arena.timeLeft = 0;

  emitLog({
    type: "arena",
    message: `Ronde afgerond (#${arena.round})`,
  });

  await storeRoundDiamonds();

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
// TOOLS
// ============================================================================

async function getTopPlayers(n: number) {
  const enhanced = [];

  for (const p of arena.players) {
    const total = await getPlayerTotal(p.id);
    enhanced.push({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: total + p.diamonds,
    });
  }

  return enhanced
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, n);
}

// ============================================================================
// SNAPSHOT
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
// RESET TOTAL DIAMONDS BIJ STOPGAME
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
  await recomputePositions();
  emitArena();

  emitLog({ type: "system", message: "Arena Engine v4.1 gestart" });
}
