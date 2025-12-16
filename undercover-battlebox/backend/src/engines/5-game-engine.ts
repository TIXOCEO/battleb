/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v16.8 (STABLE BUILD)
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;

  boosters: string[];

  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
  eliminated?: boolean;

  tempImmune?: boolean;
  survivorImmune?: boolean;

  breakerHits?: number;

  avatar_url?: string | null;
}

export interface ArenaSettings {
  roundDurationPre: number;
  roundDurationFinal: number;
  graceSeconds: number;
  forceEliminations: boolean;
}

export interface ArenaState {
  players: ArenaPlayer[];
  round: number;
  type: RoundType;
  status: ArenaStatus;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: ArenaSettings;

  firstFinalRound: number | null;
  lastSortedAt: number;

  reverseMode: boolean;
  diamondPistolUsed: boolean;
}

/* ============================================================================ */

let arena: ArenaState = {
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",

  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,

  settings: {
    roundDurationPre: 300,
    roundDurationFinal: 180,
    graceSeconds: 10,
    forceEliminations: true,
  },

  firstFinalRound: null,
  lastSortedAt: 0,

  reverseMode: false,
  diamondPistolUsed: false,
};

export function getArena() { return arena; }
export function getArenaSettings() { return arena.settings; }

/* ============================================================================ */
/*                                 SCORING LOGIC                               */
/* ============================================================================ */

async function getRoundScore(tiktokId: string, round: number) {
  const gid = (io as any)?.currentGameId;
  if (!gid || round !== arena.round) return 0;

  const r = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS score
     FROM gifts
     WHERE receiver_id=$1 AND game_id=$2 AND round_id=$3 AND is_round_gift=TRUE`,
    [BigInt(tiktokId), gid, round]
  );

  return Number(r.rows[0].score || 0);
}

async function getFinalScore(tiktokId: string) {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;
  if (!arena.firstFinalRound) return 0;

  const first = arena.firstFinalRound;

  const base = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS score
     FROM gifts WHERE receiver_id=$1 AND game_id=$2 AND round_id < $3 AND is_round_gift=TRUE`,
    [BigInt(tiktokId), gid, first]
  );

  const finale = await pool.query(
    `SELECT COALESCE(SUM(diamonds),0) AS score
     FROM gifts WHERE receiver_id=$1 AND game_id=$2 AND round_id >= $3 AND is_round_gift=TRUE`,
    [BigInt(tiktokId), gid, first]
  );

  return Number(base.rows[0].score) + Number(finale.rows[0].score);
}

async function computePlayerScore(p: ArenaPlayer) {
  if (arena.status === "idle") return 0;
  if (arena.type === "finale") return await getFinalScore(p.id);
  return await getRoundScore(p.id, arena.round);
}

/* ============================================================================ */
/*                      recomputePositions() — PATCHED                         */
/* ============================================================================ */

async function recomputePositions() {
  const status = arena.status;

  // IDLE
  if (status === "idle") {
    for (const p of arena.players) {
      p.score = 0;

      // FIX: eliminated is absolute, never overwritten
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }

      // FIX: immune only if NOT eliminated
      if (p.tempImmune || p.survivorImmune || p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      p.positionStatus = "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  // SCORE first
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // SORT
  if (arena.reverseMode)
    arena.players.sort((a, b) => a.score - b.score);
  else
    arena.players.sort((a, b) => b.score - a.score);

  // ENDED state
  if (status === "ended") {
    for (const p of arena.players) {
      // FIX: eliminated absolute priority
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }

      // FIX: immune only if not eliminated
      if (p.tempImmune || p.survivorImmune || p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      p.positionStatus = "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* ----------------------------- QUARTER LOGIC ----------------------------- */

  if (arena.type === "quarter") {
    if (arena.players.length < 6) {
      for (const p of arena.players) {
        if (p.eliminated) {
          p.positionStatus = "elimination";
          continue;
        }

        if (p.tempImmune || p.survivorImmune || p.boosters.includes("immune")) {
          p.positionStatus = "immune";
          continue;
        }

        p.positionStatus = "alive";
      }

      arena.lastSortedAt = Date.now();
      return;
    }

    const threshold = arena.players[5].score;

    for (const p of arena.players) {
      // FIX: eliminated always wins
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }

      // FIX: immune blocks danger/alive recompute
      if (p.tempImmune || p.survivorImmune || p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      // FIX: danger computed ONLY for non-eliminated non-immune
      if (arena.reverseMode) {
        p.positionStatus = p.score >= threshold ? "danger" : "alive";
      } else {
        p.positionStatus = p.score <= threshold ? "danger" : "alive";
      }
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* ------------------------------ FINALE LOGIC ----------------------------- */

  const totalFinal = arena.players.length;

  for (let i = 0; i < totalFinal; i++) {
    const p = arena.players[i];

    if (p.eliminated) {
      p.positionStatus = "elimination";
      continue;
    }

    if (p.tempImmune || p.survivorImmune || p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      continue;
    }

    if (arena.reverseMode)
      p.positionStatus = i === 0 ? "danger" : "alive";
    else
      p.positionStatus = i === totalFinal - 1 ? "danger" : "alive";
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================ */
/*                            emitArena() — UNCHANGED                           */
/* ============================================================================ */

export async function emitArena() {
  await recomputePositions();

  const now = Date.now();
  let totalMs = 0;
  let remainingMs = 0;

  if (arena.status === "active") {
    totalMs =
      (arena.type === "finale"
        ? arena.settings.roundDurationFinal
        : arena.settings.roundDurationPre) * 1000;
    remainingMs = Math.max(0, arena.roundCutoff - now);
  }

  if (arena.status === "grace") {
    totalMs = arena.settings.graceSeconds * 1000;
    remainingMs = Math.max(0, arena.graceEnd - now);
  }

  const hud = {
    round: arena.round,
    type: arena.type,
    status: arena.status,
    remainingMs,
    totalMs,
    endsAt: now + remainingMs,
    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,
    reverseMode: arena.reverseMode,
  };

  const players = arena.players.map((p) => ({
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    score: p.score,
    positionStatus: p.positionStatus,
    eliminated: !!p.eliminated,
    tempImmune: !!p.tempImmune,
    survivorImmune: !!p.survivorImmune,
    breakerHits: p.breakerHits ?? 0,
    boosters: p.boosters,
    avatar_url: p.avatar_url ?? null,
  }));

  io.emit("updateArena", {
    hud,
    players,
    round: arena.round,
    type: arena.type,
    status: arena.status,
    reverseMode: arena.reverseMode,
    diamondPistolUsed: arena.diamondPistolUsed,
    firstFinalRound: arena.firstFinalRound,
    lastSortedAt: arena.lastSortedAt,
    removeAllowed: true,
  });
}

export async function forceSort() {
  await emitArena();
}

/* ============================================================================ */
/*                              toggleGalaxyMode                                */
/* ============================================================================ */

export function toggleGalaxyMode(): boolean {
  arena.reverseMode = !arena.reverseMode;

  emitLog({
    type: "twist",
    message: `GALAXY toggle → reverseMode = ${arena.reverseMode ? "AAN" : "UIT"}`,
  });

  return arena.reverseMode;
}

/* ============================================================================ */
/*                                START ROUND                                   */
/* ============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  arena.round += 1;
  arena.type = type;

  arena.reverseMode = false;
  arena.diamondPistolUsed = false;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;

    emitLog({
      type: "arena",
      message: `⚡ Finale gestart op ronde ${arena.round}`,
    });
  }

  for (const p of arena.players) {
    p.positionStatus = "alive";
    p.eliminated = false;
    p.tempImmune = false;
    p.survivorImmune = false;
    p.breakerHits = 0;

    // reset boosters
    p.boosters = p.boosters.filter((b) => b !== "immune");
    p.boosters = p.boosters.filter((b) => b !== "mg" && b !== "bomb");
  }

  arena.status = "active";

  (io as any).roundActive = true;
  (io as any).currentRound = arena.round;

  const now = Date.now();
  const duration =
    type === "finale"
      ? arena.settings.roundDurationFinal
      : arena.settings.roundDurationPre;

  arena.roundStartTime = now;
  arena.roundCutoff = now + duration * 1000;
  arena.graceEnd = arena.roundCutoff + arena.settings.graceSeconds * 1000;

  emitLog({
    type: "arena",
    message: `Ronde ${arena.round} gestart (${type}) — duur ${duration}s`,
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
    reverseMode: arena.reverseMode,
  });
}

/* ============================================================================ */
/*                                      END ROUND                               */
/* ============================================================================ */

export async function endRound(forceEnd: boolean = false) {
  /* =========================================================
     FORCE END
     ========================================================= */
  if (forceEnd) {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();
    const total = arena.players.length;

    /* ----------------------------- FINALE ----------------------------- */

    if (arena.type === "finale") {
      if (total <= 1) {
        emitLog({
          type: "arena",
          message: `🏆 Finale winnaar: ${arena.players[0]?.display_name}`,
        });

        io.emit("round:end", {
          round: arena.round,
          type: arena.type,
          pendingEliminations: [],
          winner: arena.players[0] || null,
          top3: arena.players.slice(0, 3),
          reverseMode: arena.reverseMode,
        });

        await emitArena();
        return;
      }

      const lowest = arena.players[arena.reverseMode ? 0 : total - 1].score;
      const doomed = arena.players.filter((p) => p.score === lowest);

      for (const p of doomed) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminaties: ${doomed.map((x) => x.display_name).join(", ")}`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: doomed.map((x) => x.username),
        top3: arena.players.slice(0, 3),
        reverseMode: arena.reverseMode,
      });

      await emitArena();
      return;
    }

    /* ----------------------------- QUARTER ----------------------------- */

    if (total < 6) {
      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3),
        reverseMode: arena.reverseMode,
      });

      await emitArena();
      return;
    }

    const doomed = arena.players.filter((p) => p.positionStatus === "danger");

    for (const p of doomed) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed.map((x) => x.username),
      top3: arena.players.slice(0, 3),
      reverseMode: arena.reverseMode,
    });

    await emitArena();
    return;
  }

  /* =========================================================
     ACTIVE → GRACE
     ========================================================= */
  if (arena.status === "active") {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: `⏳ Grace periode gestart (${arena.settings.graceSeconds}s)`,
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
      reverseMode: arena.reverseMode,
    });

    await emitArena();
    return;
  }

  /* =========================================================
     GRACE → END
     ========================================================= */
  if (arena.status === "grace") {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();

    const doomedMG = arena.players.filter((p) => p.eliminated);

    /* ----------------------------- FINALE ----------------------------- */

    if (arena.type === "finale") {
      if (doomedMG.length) {
        emitLog({
          type: "arena",
          message: `💀 MG/Bomb eliminaties: ${doomedMG.map((x) => x.display_name).join(", ")}`,
        });

        io.emit("round:end", {
          round: arena.round,
          type: "finale",
          pendingEliminations: doomedMG.map((x) => x.username),
          top3: arena.players.slice(0, 3),
          reverseMode: arena.reverseMode,
        });

        await emitArena();
        return;
      }

      const index = arena.reverseMode ? 0 : arena.players.length - 1;
      const lowest = arena.players[index].score;
      const doomedTie = arena.players.filter((p) => p.score === lowest);

      for (const p of doomedTie) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale tie-eliminaties: ${doomedTie.map((x) => x.display_name).join(", ")}`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: doomedTie.map((x) => x.username),
        top3: arena.players.slice(0, 3),
        reverseMode: arena.reverseMode,
      });

      await emitArena();
      return;
    }

    /* ----------------------------- QUARTER ----------------------------- */

    const doomedDanger = arena.settings.forceEliminations
      ? arena.players.filter((p) => p.positionStatus === "danger")
      : [];

    for (const p of doomedDanger) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    const doomed = [
      ...doomedMG.map((x) => x.username),
      ...doomedDanger.map((x) => x.username),
    ];

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — totale eliminaties: ${doomed.length}`,
    });

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3: arena.players.slice(0, 3),
      reverseMode: arena.reverseMode,
    });

    await emitArena();
  }
}

/* ============================================================================ */
/*                               ARENA MANAGEMENT                               */
/* ============================================================================ */

export async function arenaJoin(
  id: string,
  display_name: string,
  username: string,
  avatar_url?: string | null
) {
  const cleanId = String(id);
  if (arena.players.some((p) => p.id === cleanId)) return;

  arena.players.push({
    id: cleanId,
    username: username.replace(/^@+/, "").toLowerCase(),
    display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
    tempImmune: false,
    survivorImmune: false,
    breakerHits: 0,
    avatar_url: avatar_url ?? null,
  });

  await emitArena();
}

export async function arenaLeave(identifier: string, force: boolean = false) {
  const raw = String(identifier).replace(/^@+/, "").trim().toLowerCase();

  const idx = arena.players.findIndex(
    (p) =>
      p.id === raw ||
      p.username === raw ||
      p.display_name?.toLowerCase() === raw
  );

  if (idx === -1) return;

  const p = arena.players[idx];

  if (force) {
    arena.players.splice(idx, 1);
    emitLog({ type: "elim", message: `${p.display_name} permanent verwijderd uit arena` });
    await emitArena();
    return;
  }

  p.positionStatus = "elimination";
  p.eliminated = true;

  emitLog({ type: "elim", message: `${p.display_name} gemarkeerd als eliminated` });
  await emitArena();
}

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;
  arena.reverseMode = false;
  arena.diamondPistolUsed = false;

  emitLog({ type: "arena", message: `Arena volledig gereset` });
  await emitArena();
}

/* ============================================================================ */
/*                                     TICK                                     */
/* ============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({ type: "arena", message: "⏳ Automatische overgang naar GRACE" });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
      reverseMode: arena.reverseMode,
    });

    await emitArena();
    return;
  }

  if (arena.status === "grace" && now >= arena.graceEnd) {
    await endRound();
  }
}, 1000);

/* ============================================================================ */
/*                                   EXPORT                                     */
/* ============================================================================ */

export default {
  getArena,
  getArenaSettings,
  emitArena,
  startRound,
  endRound,
  arenaJoin,
  arenaLeave,
  arenaClear,
  forceSort,
  toggleGalaxyMode,
};
