// ============================================================================
// arena-engine.ts — Arena & Round Engine (BattleBox v7.0 — Clean Rewrite)
// 100% functional match with your current engine logic
// ============================================================================

import pool from "../db";

// Arena State (in-memory)
let arena = {
  round: 0,
  type: "quarter" as "quarter" | "finale",
  status: "idle" as "idle" | "active" | "grace" | "ended",
  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,
  players: [] as any[],
  settings: {
    forceEliminations: true,
    roundDuration: 90,
    graceDuration: 8,
  },
};

// ============================================================================
// BASIC GETTERS
// ============================================================================
export function getArenaRaw() {
  return arena;
}

export function getArenaSettings() {
  return arena.settings;
}

// ============================================================================
// ARENA MODIFIERS
// ============================================================================
export async function arenaClear() {
  arena.players = [];
  arena.status = "idle";
  arena.round = 0;
}

export async function arenaJoin(id: string, display_name: string, username: string) {
  const exists = arena.players.some((p) => p.id === id);
  if (exists) return;

  arena.players.push({
    id,
    display_name,
    username,
    status: "alive",
    positionStatus: "alive",
    score: 0,
  });
}

export async function arenaLeave(id: string) {
  arena.players = arena.players.filter((p) => p.id !== id);
}

// ============================================================================
// ROUND START
// ============================================================================
export function startRound(type: "quarter" | "finale") {
  if (arena.status === "active") return false;

  arena.round++;
  arena.type = type;
  arena.status = "active";

  const now = Date.now();
  arena.roundStartTime = now;

  arena.roundCutoff = now + arena.settings.roundDuration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceDuration * 1000;

  // reset statuses
  arena.players = arena.players.map((p) => ({
    ...p,
    positionStatus: "alive",
  }));

  return true;
}

// ============================================================================
// ROUND END (to grace → eliminated → ended)
// ============================================================================
export async function endRound() {
  if (arena.status === "active") {
    arena.status = "grace";
    return;
  }

  if (arena.status === "grace") {
    arena.status = "ended";

    // Mark lowest player(s) as elimination
    if (arena.settings.forceEliminations) {
      if (arena.players.length > 0) {
        const lowest = Math.min(...arena.players.map((p) => p.score || 0));
        arena.players = arena.players.map((p) =>
          p.score === lowest
            ? { ...p, positionStatus: "elimination" }
            : p
        );
      }
    }
  }
}

// ============================================================================
// EXTERNAL UPDATE HELPERS
// ============================================================================
export function emitArenaState(io: any, snap: any) {
  io.emit("updateArena", snap);
}
