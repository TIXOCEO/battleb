/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v13.1 — CLEAN & FIXED
   ✔ Compatibel met server.ts v6.x
   ✔ Geen dubbele exports meer
   ✔ Gifts-driven scores
   ✔ Correcte sorting + danger + elimination
   ✔ Admin "safe" kan later eenvoudig worden toegevoegd
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
}

interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
}

interface ArenaState {
  players: ArenaPlayer[];
  round: number;
  type: RoundType;
  status: ArenaStatus;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;
  lastSortedAt: number;
}

/* ============================================================================
   MEMORY STATE
============================================================================ */

let arena: ArenaState = {
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",

  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,

  settings: {
    roundDurationPre: 60,
    roundDurationFinal: 60,
    graceSeconds: 10,
    forceEliminations: true,
  },

  lastSortedAt: 0,
};

/* ============================================================================
   GET ARENA (SINGLE, CLEAN EXPORT)
============================================================================ */
export function getArena(): ArenaState {
  return arena;
}

/* ============================================================================
   SCORE CALCULATION
============================================================================ */

async function getPlayerScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds), 0) AS score
      FROM gifts
      WHERE receiver_id = $1
        AND game_id = $2
    `,
    [BigInt(tiktokId), gid]
  );

  return Number(q.rows[0]?.score ?? 0);
}

/* ============================================================================
   SORTING + POSITION STATUSES
============================================================================ */

async function recomputePositions() {
  for (const p of arena.players) {
    p.score = await getPlayerScore(p.id);
  }

  arena.players.sort((a, b) => b.score - a.score);

  const total = arena.players.length;

  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.positionStatus === "immune") continue;

    if (i >= total - 3) p.positionStatus = "elimination";
    else if (i >= total - 5) p.positionStatus = "danger";
    else p.positionStatus = "alive";
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT ARENA
============================================================================ */

export async function emitArena() {
  await recomputePositions();

  io.emit("updateArena", {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,

    timeLeft: 0,
    isRunning: arena.status === "active",

    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,

    settings: arena.settings,
    lastSortedAt: arena.lastSortedAt,
  });
}

/* ============================================================================
   START ROUND
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena");

  arena.type = type;
  arena.round += 1;
  arena.status = "active";

  const duration =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

  const now = Date.now();

  arena.roundStartTime = now;
  arena.roundCutoff = now + duration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  emitLog({
    type: "arena",
    message: `Ronde gestart (${type}) – ${duration}s`,
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
  });
}

/* ============================================================================
   END ROUND
============================================================================ */

export async function endRound() {
  if (arena.status === "active") {
    arena.status = "grace";
    await emitArena();

    emitLog({ type: "arena", message: "Grace gestart" });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    return;
  }

  if (arena.status === "grace") {
    arena.status = "ended";

    await recomputePositions();

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — eliminaties nodig (${doomed.length})`,
    });

    await emitArena();
  }
         }

/* ============================================================================
   ADD PLAYER TO ARENA (MANUAL ADD)
============================================================================ */
export async function addToArena(username: string, resolveUser: Function) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const user = await resolveUser(clean);
  if (!user) throw new Error("Gebruiker niet gevonden");

  const exists = arena.players.find((p) => p.id === String(user.tiktok_id));
  if (exists) throw new Error("Speler zit al in arena");

  const score = await getPlayerScore(String(user.tiktok_id));

  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username,
    display_name: user.display_name,
    score,
    positionStatus: "alive",
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} toegevoegd aan arena`,
  });

  await emitArena();
}

/* ============================================================================
   ELIMINATE PLAYER
============================================================================ */
export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const index = arena.players.findIndex((p) => p.username === clean);
  if (index === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[index];

  arena.players.splice(index, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} geëlimineerd`,
  });

  await emitArena();
}

/* ============================================================================
   QUEUE → ARENA (server.ts calls this)
============================================================================ */
export async function addFromQueue(user: any) {
  const score = await getPlayerScore(String(user.tiktok_id));

  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username,
    display_name: user.display_name,
    score,
    positionStatus: "alive",
  });

  await emitArena();
}

/* ============================================================================
   RESET ARENA COMPLETELY
============================================================================ */
export async function resetArena() {
  arena.players = [];
  arena.round = 0;
  arena.type = "quarter";
  arena.status = "idle";

  arena.roundStartTime = 0;
  arena.roundCutoff = 0;
  arena.graceEnd = 0;

  arena.lastSortedAt = Date.now();

  emitLog({ type: "reset", message: "Arena volledig gereset" });

  await emitArena();
}

/* ============================================================================
   UPDATE SETTINGS
============================================================================ */
export async function updateArenaSettings(
  newSettings: Partial<ArenaState["settings"]>
) {
  arena.settings = {
    ...arena.settings,
    ...newSettings,
  };

  io.emit("settings", arena.settings);

  emitLog({
    type: "system",
    message: `Settings gewijzigd: ${JSON.stringify(newSettings)}`,
  });

  await emitArena();
}

/* ============================================================================
   FORCE RECOMPUTE (ADMIN BUTTON)
============================================================================ */
export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

/* ============================================================================
   TIMER LOOP — CORE ROUND LOGIC TICKS
============================================================================ */
setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // ACTIVE → GRACE
  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: "⏳ Grace periode gestart",
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  // GRACE → ENDED
  if (arena.status === "grace" && now >= arena.graceEnd) {
    arena.status = "ended";

    await recomputePositions();

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `⛔ Ronde beëindigd — eliminaties nodig (${doomed.length})`,
    });

    await emitArena();
  }
}, 1000);

/* ============================================================================
   EXPORTS — CLEAN, NO DUPLICATES
============================================================================ */
export default {
  getArena,
  emitArena,
  startRound,
  endRound,
  addToArena,
  eliminate,
  addFromQueue,
  updateArenaSettings,
  resetArena,
  forceSort,
};
