/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v16.3 (Galaxy Reverse Upgrade)
   ✔ Immune = 1 ronde geldig
   ✔ MG/Bomb markers blijven tot nieuwe ronde
   ✔ Reverse ranking (Galaxy)
   ✔ Reverse danger / finale eliminaties
   ✔ Reverse reset bij startRound & arenaClear
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

  // ★ GALAXY ADDITION
  reverseMode: boolean;
}

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
    forceEliminations: true
  },

  firstFinalRound: null,
  lastSortedAt: 0,

  // ★ GALAXY ADDITION — standaard normaal
  reverseMode: false
};

/* ============================================================================
   LOAD SETTINGS
============================================================================ */

export async function loadArenaSettingsFromDB() {
  const r = await pool.query(`
    SELECT round_pre_seconds, round_final_seconds, grace_seconds
    FROM arena_settings
    LIMIT 1
  `);

  if (!r.rows.length) return;

  const s = r.rows[0];

  arena.settings.roundDurationPre = Number(s.round_pre_seconds);
  arena.settings.roundDurationFinal = Number(s.round_final_seconds);
  arena.settings.graceSeconds = Number(s.grace_seconds);

  console.log("✔ Arena settings geladen:", arena.settings);
}

export function getArena() {
  return arena;
}

export function getArenaSettings() {
  return arena.settings;
}

/* ============================================================================
   SCORE SYSTEM
============================================================================ */

async function getRoundScore(tiktokId: string, round: number) {
  const gid = (io as any)?.currentGameId;

  if (!gid || round !== arena.round) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id=$3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, round]
  );

  return Number(q.rows[0]?.score || 0);
}

async function getFinalScore(tiktokId: string) {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;
  if (!arena.firstFinalRound) return 0;

  const first = arena.firstFinalRound;

  const base = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE game_id=$2
        AND receiver_id=$1
        AND round_id < $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  const finale = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE game_id=$2
        AND receiver_id=$1
        AND round_id >= $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  return Number(base.rows[0].score) + Number(finale.rows[0].score);
}

async function computePlayerScore(p: ArenaPlayer) {
  if (arena.status === "idle") return 0;

  if (arena.type === "finale") return await getFinalScore(p.id);
  return await getRoundScore(p.id, arena.round);
}

/* ============================================================================
   RECOMPUTE POSITIONS
============================================================================ */

async function recomputePositions() {
  const status = arena.status;
  const total = arena.players.length;

  if (status === "idle") {
    for (const p of arena.players) {
      p.score = 0;

      if (p.eliminated) p.positionStatus = "elimination";
      else if (p.tempImmune || p.survivorImmune) p.positionStatus = "immune";
      else if (p.boosters.includes("immune")) p.positionStatus = "immune";
      else p.positionStatus = "alive";
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  // SCORES
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // ★ GALAXY ADDITION — normale sort = hoog → laag
  // indien reverseMode actief = laag → hoog
  if (arena.reverseMode) {
    arena.players.sort((a, b) => a.score - b.score); // reversed
  } else {
    arena.players.sort((a, b) => b.score - a.score); // normaal
  }

  if (status === "ended") {
    for (const p of arena.players) {
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }
      if (p.tempImmune || p.survivorImmune) {
        p.positionStatus = "immune";
        continue;
      }
      if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  /* ============================================================================
     QUARTER LOGIC
  ============================================================================ */
  if (arena.type === "quarter") {
    if (total < 6) {
      for (const p of arena.players) {
        if (p.eliminated) p.positionStatus = "elimination";
        else if (p.tempImmune || p.survivorImmune) p.positionStatus = "immune";
        else if (p.boosters.includes("immune")) p.positionStatus = "immune";
        else p.positionStatus = "alive";
      }
      arena.lastSortedAt = Date.now();
      return;
    }

    // normale threshold = 5e speler (index 5)
    // reversed threshold = zelfde positie want lijst is al omgekeerd gesorteerd

    const threshold = arena.players[5].score;

    for (const p of arena.players) {
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }
      if (p.tempImmune || p.survivorImmune) {
        p.positionStatus = "immune";
        continue;
      }
      if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      // ★ GALAXY ADDITION — danger altijd onderaan lijst,
      // maar lijst is al reversed of niet, dus zelfde check
      p.positionStatus = p.score <= threshold ? "danger" : "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* ============================================================================
     FINALE LOGIC
  ============================================================================ */

  const totalFinal = arena.players.length;

  for (let i = 0; i < totalFinal; i++) {
    const p = arena.players[i];

    if (p.eliminated) {
      p.positionStatus = "elimination";
      continue;
    }

    if (p.tempImmune || p.survivorImmune) {
      p.positionStatus = "immune";
      continue;
    }

    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      continue;
    }

    // Normaal: laatste plek = danger (index = laatste)
    // Reversed: lijst is al omgekeerd gesorteerd, dus danger blijft laatste
    p.positionStatus = i === totalFinal - 1 ? "danger" : "alive";
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT SNAPSHOT
============================================================================ */

export async function emitArena() {
  await recomputePositions();

  io.emit("updateArena", {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,

    isRunning: arena.status === "active",

    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,

    settings: arena.settings,
    firstFinalRound: arena.firstFinalRound,
    lastSortedAt: arena.lastSortedAt,

    // ★ GALAXY ADDITION — expose to frontend
    reverseMode: arena.reverseMode,

    removeAllowed: arena.status === "idle" || arena.status === "ended"
  });
}

export async function forceSort() {
  await emitArena();
}

/* ============================================================================
   START ROUND — reset immune + MG/Bomb markers + reverseMode reset
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  arena.round += 1;
  arena.type = type;

  // ★ GALAXY — ALWAYS RESET AT NEW ROUND
  arena.reverseMode = false;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;

    emitLog({
      type: "arena",
      message: `⚡ Finale gestart op ronde ${arena.round}`
    });
  }

  for (const p of arena.players) {
    p.positionStatus = "alive";
    p.eliminated = false;

    p.tempImmune = false;
    p.survivorImmune = false;

    p.boosters = p.boosters.filter((b) => b !== "immune");

    // reset MG/Bomb badges
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
    message: `Ronde ${arena.round} gestart (${type}) — duur ${duration}s`
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration
  });
}

/* ============================================================================
   END ROUND — MoneyGun/Bomb + Survivor Immune verwerking
============================================================================ */

export async function endRound(forceEnd: boolean = false) {
  /* ------------------------------------------------------------------------
     FORCE STOP — direct naar ENDED
  ------------------------------------------------------------------------- */
  if (forceEnd) {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();
    const total = arena.players.length;

    /* --- FINALE TIE ELIMINATIE --- */
    if (arena.type === "finale") {
      if (total <= 1) {
        emitLog({
          type: "arena",
          message: `🏆 Finale winnaar: ${arena.players[0]?.display_name}`
        });

        io.emit("round:end", {
          round: arena.round,
          type: arena.type,
          pendingEliminations: [],
          winner: arena.players[0] || null,
          top3: arena.players.slice(0, 3)
        });

        await emitArena();
        return;
      }

      const lowest = arena.players[total - 1].score;
      const doomed = arena.players.filter((p) => p.score === lowest);

      for (const p of doomed) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminaties: ${doomed
          .map((x) => x.display_name)
          .join(", ")}`
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: doomed.map((x) => x.username),
        top3: arena.players.slice(0, 3)
      });

      await emitArena();
      return;
    }

    /* --- QUARTER — DANGER ELIMINATIE --- */
    if (total < 6) {
      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3)
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
      top3: arena.players.slice(0, 3)
    });

    await emitArena();
    return;
  }

  /* ------------------------------------------------------------------------
     ACTIVE → GRACE
  ------------------------------------------------------------------------- */
  if (arena.status === "active") {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: `⏳ Grace periode gestart (${arena.settings.graceSeconds}s)`
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds
    });

    await emitArena();
    return;
  }

  /* ------------------------------------------------------------------------
     GRACE → ENDED (MG/Bomb eerst)
  ------------------------------------------------------------------------- */
  if (arena.status === "grace") {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();
    const total = arena.players.length;

    /* =======================================================================
       FINALE — eerst MG/BOMB eliminaties, dan tie
    ======================================================================= */
    if (arena.type === "finale") {
      const doomedMG = arena.players.filter((p) => p.eliminated);

      if (doomedMG.length) {
        emitLog({
          type: "arena",
          message: `💀 MG/Bomb eliminaties: ${doomedMG
            .map((x) => x.display_name)
            .join(", ")}`
        });

        io.emit("round:end", {
          round: arena.round,
          type: arena.type,
          pendingEliminations: doomedMG.map((x) => x.username),
          top3: arena.players.slice(0, 3)
        });

        await emitArena();
        return;
      }

      // Geen MG/BOMB → normale finale tie
      if (total <= 1) {
        emitLog({
          type: "arena",
          message: `🏆 Finale winnaar: ${arena.players[0]?.display_name}`
        });

        io.emit("round:end", {
          round: arena.round,
          type: "finale",
          pendingEliminations: [],
          winner: arena.players[0] || null,
          top3: arena.players.slice(0, 3)
        });

        await emitArena();
        return;
      }

      const lowest = arena.players[total - 1].score;
      const doomedTie = arena.players.filter((p) => p.score === lowest);

      for (const p of doomedTie) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminaties (tie): ${doomedTie
          .map((x) => x.display_name)
          .join(", ")}`
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: doomedTie.map((x) => x.username),
        top3: arena.players.slice(0, 3)
      });

      await emitArena();
      return;
    }

    /* =======================================================================
       QUARTER — eerst MG/BOMB, daarna danger
    ======================================================================= */

    const doomedMG = arena.players.filter((p) => p.eliminated);
    const doomedDanger =
      arena.settings.forceEliminations &&
      arena.players.filter((p) => p.positionStatus === "danger");

    const doomed = [
      ...doomedMG.map((x) => x.username),
      ...(doomedDanger || []).map((x) => x.username)
    ];

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — totale eliminaties: ${doomed.length}`
    });

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed,
      top3: arena.players.slice(0, 3)
    });

    await emitArena();
  }
}

/* ============================================================================
   EXPORT DEFAULT
============================================================================ */

export default {
  getArena,
  getArenaSettings,
  emitArena,

  startRound,
  endRound,

  arenaJoin,
  arenaLeave,
  arenaClear,
  addToArena,
  eliminate,
  addFromQueue,

  updateArenaSettings,
  resetArena: arenaClear,

  forceSort
};
