/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v13.0
   WORKS WITH:
   ✔ server.ts v6.x
   ✔ gift-engine v14.1 (diamonds-only)
   ✔ full leaderboard + realtime sorting
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   ARENA STATE IN MEMORY
============================================================================ */

interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;

  score: number;
  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
}

interface ArenaInternalState {
  players: ArenaPlayer[];
  round: number;
  type: "quarter" | "finale";
  status: "idle" | "active" | "grace" | "ended";

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: {
    roundDurationPre: number;
    roundDurationFinal: number;
    graceSeconds: number;
    forceEliminations: boolean;
  };

  lastSortedAt: number;
}

let arena: ArenaInternalState = {
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
   EXPORT GETTER
============================================================================ */
export function getArena() {
  return arena;
}

/* ============================================================================
   SCORE CALCULATION (GIFTS ONLY)
============================================================================ */
async function getPlayerScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds), 0) AS score
      FROM gifts
      WHERE receiver_id = $1 AND game_id = $2
    `,
    [BigInt(tiktokId), gid]
  );

  return Number(q.rows[0]?.score ?? 0);
}

/* ============================================================================
   INTERNAL: SORT + ASSIGN POSITION STATUS
============================================================================ */
async function recomputePositions() {
  // Load scores fresh from DB for every player
  for (const p of arena.players) {
    p.score = await getPlayerScore(p.id);
  }

  // Sort DESC by score
  arena.players.sort((a, b) => b.score - a.score);

  // Assign safe / danger / elimination
  const total = arena.players.length;

  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.positionStatus === "immune") continue;

    if (i >= total - 3) {
      p.positionStatus = "elimination";
    } else if (i >= total - 5) {
      p.positionStatus = "danger";
    } else {
      p.positionStatus = "alive";
    }
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT ARENA TO FRONTEND
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
export async function startRound(type: "quarter" | "finale") {
  if (!arena.players.length) {
    throw new Error("Geen spelers in arena");
  }

  arena.type = type;
  arena.round += 1;
  arena.status = "active";

  const duration =
    type === "quarter"
      ? arena.settings.roundDurationPre
      : arena.settings.roundDurationFinal;

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
   END ROUND → GRACE OR FINAL
============================================================================ */
export async function endRound() {
  if (arena.status === "active") {
    // Go into grace
    arena.status = "grace";
    await emitArena();

    emitLog({ type: "arena", message: "Grace periode gestart" });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    return;
  }

  if (arena.status === "grace") {
    // Fully end round
    arena.status = "ended";

    await recomputePositions();

    const top3 = arena.players
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        display_name: p.display_name,
        username: p.username,
        diamonds: p.score,
      }));

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `Ronde beëindigd — eliminaties vereist (${doomed.length})`,
    });

    await emitArena();
    return;
  }
}

/* ============================================================================
   ADD PLAYER TO ARENA
============================================================================ */
export async function addToArena(username: string, resolveUser: Function) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const user = await resolveUser(clean);
  if (!user) throw new Error("Gebruiker niet gevonden");

  const already = arena.players.find((p) => p.id === String(user.tiktok_id));
  if (already) throw new Error("Speler zit al in arena");

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
   REMOVE PLAYER (ELIMINATE)
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
   QUEUE → ARENA HANDLER (SERVER CALLS THIS)
============================================================================ */
export async function addFromQueue(user: any) {
  const score = await getPlayerScore(user.tiktok_id);

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
   RESET ARENA (VOLLEDIG)
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
   UPDATE SETTINGS (ADMIN)
============================================================================ */
export async function updateArenaSettings(newSettings: Partial<ArenaState["settings"]>) {
  arena.settings = {
    ...arena.settings,
    ...newSettings,
  };

  io.emit("settings", arena.settings);

  emitLog({
    type: "system",
    message: `Settings geüpdatet: ${JSON.stringify(newSettings)}`,
  });

  await emitArena();
}

/* ============================================================================
   SAFE GET ARENA (SERVER CALLS THIS)
============================================================================ */
export function getArena() {
  return arena;
}

/* ============================================================================
   FORCE RECOMPUTE POSITIONS PUBLIC
============================================================================ */
export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

/* ============================================================================
   TIMER LOOP — LIVE ROUND LOGICA
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

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      username: p.username,
      diamonds: p.score,
    }));

    const doomed = arena.players
      .filter((p) => p.positionStatus === "elimination")
      .map((p) => p.username);

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3,
    });

    emitLog({
      type: "arena",
      message: `⛔ Ronde beëindigd — eliminaties vereist (${doomed.length})`,
    });

    await emitArena();
    return;
  }
}, 1000);

/* ============================================================================
   EXPORTS
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
