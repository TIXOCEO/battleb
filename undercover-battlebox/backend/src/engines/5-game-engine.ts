/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v15.4
   ✔ Finaleronde: bottom-1 danger + eliminatie
   ✔ Sorteert altijd op totale score
   ✔ Quarter danger = posities 6–8
   ✔ Finale werkt tot winnaar
   ✔ IDLE toont GEEN scores
   ✔ Eliminated spelers blijven elimination in ENDED
   ✔ New players IDLE: krijgen geen vorige ronde gifts
   ✔ Admin remove-knop: enabled bij ENDED of IDLE
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
    forceEliminations: true,
  },

  firstFinalRound: null,
  lastSortedAt: 0,
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
   SCORE SYSTEM — FIXED
============================================================================ */

async function getRoundScore(tiktokId: string, round: number) {
  const gid = (io as any)?.currentGameId;

  // New players should never inherit old round gifts
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
   RECOMPUTE POSITIONS — FIXED
============================================================================ */

async function recomputePositions() {
  const status = arena.status;
  const total = arena.players.length;

  /* --------------------------------------
     IDLE → scores always 0
  ---------------------------------------*/
  if (status === "idle") {
    for (const p of arena.players) {
      p.score = 0;
      p.positionStatus = p.boosters.includes("immune")
        ? "immune"
        : "alive";
      // eliminated flag blijft staan, host kan opruimen
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  /* --------------------------------------
     Load real scores
  ---------------------------------------*/
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  arena.players.sort((a, b) => b.score - a.score);

  /* --------------------------------------
     ENDED — DO NOT OVERRIDE ELIMINATION
  ---------------------------------------*/
  if (status === "ended") {
    for (const p of arena.players) {
      if (p.eliminated) {
        p.positionStatus = "elimination";
      } else if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
      }
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  /* --------------------------------------
     QUARTER danger
  ---------------------------------------*/
  if (arena.type === "quarter") {
    if (total < 6) {
      for (const p of arena.players) {
        p.positionStatus = p.boosters.includes("immune")
          ? "immune"
          : "alive";
      }
      arena.lastSortedAt = Date.now();
      return;
    }

    for (let i = 0; i < total; i++) {
      const p = arena.players[i];

      if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      if (i <= 4) p.positionStatus = "alive";
      else if (i >= 5 && i <= 7) p.positionStatus = "danger";
      else p.positionStatus = "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* --------------------------------------
     FINALE danger — bottom-1
  ---------------------------------------*/
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      continue;
    }

    p.positionStatus = (i === total - 1) ? "danger" : "alive";
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT SNAPSHOT — removeAllowed toegevoegd
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

    // 🎯 Nieuw: frontend mag weggooiknoppen tonen in IDLE & ENDED
    removeAllowed: arena.status === "idle" || arena.status === "ended",
  });
}

/* ============================================================================
   START ROUND — v15.4
   ✔ Nieuwe ronde: iedereen ALIVE (eliminated blijft TRUE)
   ✔ Geen oude scores meenemen
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  // Nieuwe ronde
  arena.round += 1;
  arena.type = type;

  // Markeer eerste finale-ronde
  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;

    emitLog({
      type: "arena",
      message: `⚡ Finale gestart op ronde ${arena.round}`,
    });
  }

  // Iedereen weer ALIVE, maar eliminated blijft TRUE (host moet dan verwijderen)
  for (const p of arena.players) {
    p.positionStatus = "alive";
  }

  arena.status = "active";

  // Timers
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
  });
}

/* ============================================================================
   END ROUND — v15.4
   ✔ ACTIVE → GRACE
   ✔ GRACE → END
   ✔ Finales: altijd bottom-1 eliminatie
   ✔ Eliminated spelers blijven elimination-status behouden
============================================================================ */

export async function endRound() {

  /* -------------------------
     PHASE 1: ACTIVE → GRACE
  --------------------------*/
  if (arena.status === "active") {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: `⏳ Grace periode gestart (${arena.settings.graceSeconds}s)`,
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  /* -------------------------
     PHASE 2: GRACE → ENDED
  --------------------------*/
  if (arena.status === "grace") {
    arena.status = "ended";

    await recomputePositions(); // gebruikt nu elimination-correctie
    const total = arena.players.length;

    /* ======================================================
         FINALE – bottom-1 eliminatie
       ====================================================== */
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
        });

        await emitArena();
        return;
      }

      const doomed = arena.players[total - 1];
      doomed.positionStatus = "elimination";
      doomed.eliminated = true;

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminatie: ${doomed.display_name}`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: [doomed.username],
        top3: arena.players.slice(0, 3),
      });

      await emitArena();
      return;
    }

    /* ======================================================
         NORMAL (QUARTER) ELIMINATIES
       ====================================================== */

    if (total < 6) {
      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3),
      });

      await emitArena();
      return;
    }

    const doomed = arena.players
      .map((p, i) => ({ p, i }))
      .filter((x) => x.i >= 5 && x.i <= 7)
      .map((x) => x.p);

    for (const p of doomed) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    emitLog({
      type: "arena",
      message: `Ronde geëindigd — eliminaties: ${doomed.length}`,
    });

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed.map((x) => x.username),
      top3: arena.players.slice(0, 3),
    });

    await emitArena();
  }
}

/* ============================================================================
   ARENA MANAGEMENT — JOIN / LEAVE
   ✔ Nieuwe speler krijgt ALTIJD score 0 (nooit oude ronde-score)
   ✔ eliminated = false bij join
============================================================================ */

export async function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string
) {
  const id = String(tiktok_id);

  // Reeds in arena → skip
  if (arena.players.some((p) => p.id === id)) return;

  // Nieuwe speler heeft NOOIT oude scores
  arena.players.push({
    id,
    username: username.replace(/^@+/, "").toLowerCase(),
    display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  await emitArena();
}

/* ============================================================================
   ARENA LEAVE — remove button
============================================================================ */

export async function arenaLeave(tiktok_id: string) {
  const id = String(tiktok_id);

  const idx = arena.players.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} uit arena verwijderd door host`,
  });

  await emitArena();
}

/* ============================================================================
   ADD BY USER LOOKUP — admin manual add
   ✔ Nieuwe speler wordt behandeld als 100% nieuw
============================================================================ */

export async function addToArena(username: string, resolveUser: Function) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const user = await resolveUser(clean);
  if (!user) throw new Error("Gebruiker niet gevonden");

  if (arena.players.some((p) => p.id === String(user.tiktok_id)))
    throw new Error("Speler zit al in arena");

  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} handmatig toegevoegd aan arena`,
  });

  await emitArena();
}

/* ============================================================================
   ELIMINATE (ADMIN) — direct verwijderen
============================================================================ */

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex(
    (p) => p.username.toLowerCase() === clean
  );
  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({
    type: "elim",
    message: `${p.display_name} handmatig geëlimineerd`,
  });

  await emitArena();
}

/* ============================================================================
   QUEUE → ARENA (AUTO JOIN)
   ✔ Nooit oude score
   ✔ Altijd verse speler
============================================================================ */

export async function addFromQueue(user: any) {
  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
  });

  await emitArena();
}

/* ============================================================================
   ARENA CLEAR — FULL RESET
============================================================================ */

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;

  emitLog({
    type: "arena",
    message: `Arena volledig gereset`,
  });

  await emitArena();
}

/* ============================================================================
   FORCE SORT — admin dépannage
============================================================================ */

export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

/* ============================================================================
   UPDATE SETTINGS — persistent
============================================================================ */

export async function updateArenaSettings(
  newSettings: Partial<ArenaSettings>
) {
  arena.settings = { ...arena.settings, ...newSettings };

  io.emit("settings", arena.settings);

  emitLog({
    type: "system",
    message: `Settings geüpdatet: ${JSON.stringify(newSettings)}`,
  });

  await emitArena();
}

/* ============================================================================
   TIMER LOOP — ACTIVE → GRACE → END
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // ACTIVE → GRACE
  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: "⏳ Automatische overgang naar GRACE",
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds,
    });

    await emitArena();
    return;
  }

  // GRACE → ENDED → eliminaties
  if (arena.status === "grace" && now >= arena.graceEnd) {
    await endRound();
    return;
  }
}, 1000);

/* ============================================================================
   EXPORT
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

  forceSort,
};
