/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v15.2
   ✔ Finaleronde: ALTIJD bottom-1 danger & eliminatie
   ✔ Sorteert altijd op totale score (quarter + finale baselines)
   ✔ Finale werkt door tot 1 winnaar
   ✔ Quarter danger = 6–8
   ✔ DB-round scoring: is_round_gift=TRUE ONLY
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

export interface ArenaPlayer {
  id: string;                     // TikTok ID
  username: string;
  display_name: string;
  score: number;                  // total computed score
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

/* ============================================================================
   MEMORY
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
    ORDER BY id ASC
    LIMIT 1
  `);

  if (!r.rows.length) {
    console.log("⚠ Geen arena_settings gevonden, defaults gebruikt.");
    return;
  }

  const row = r.rows[0];

  arena.settings.roundDurationPre = Number(row.round_pre_seconds);
  arena.settings.roundDurationFinal = Number(row.round_final_seconds);
  arena.settings.graceSeconds = Number(row.grace_seconds);

  console.log("✔ Arena settings geladen:", arena.settings);
}

export function getArena(): ArenaState {
  return arena;
}

export function getArenaSettings(): ArenaSettings {
  return arena.settings;
}

/* ============================================================================
   SCORE SYSTEM — ALWAYS TOTAL SCORE
============================================================================ */

async function getRoundScore(tiktokId: string, round: number): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid || !round) return 0;

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

async function getFinalScore(tiktokId: string): Promise<number> {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;
  if (!arena.firstFinalRound) return 0;

  const first = arena.firstFinalRound;

  const baselineQ = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id < $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  const finaleQ = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id >= $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  return (
    Number(baselineQ.rows[0]?.score || 0) +
    Number(finaleQ.rows[0]?.score || 0)
  );
}

async function computePlayerScore(player: ArenaPlayer): Promise<number> {
  if (arena.type === "finale") return await getFinalScore(player.id);

  return await getRoundScore(player.id, arena.round);
}

/* ============================================================================
   RECOMPUTE POSITIONS — v15.2
   ✔ Sorteert ALTIJD op totale score (quarter + finale)
   ✔ Quarter danger = 6–8
   ✔ Finale danger = laatste speler (index = n-1)
============================================================================ */

async function recomputePositions() {
  // Update scores
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // Sorteren desc
  arena.players.sort((a, b) => b.score - a.score);
  const total = arena.players.length;

  if (arena.status === "idle") {
    // idle mode → geen danger
    for (const p of arena.players) {
      p.positionStatus = p.boosters.includes("immune")
        ? "immune"
        : "alive";
      p.eliminated = false;
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  /* -------------------------------
     QUARTER LOGICA
  --------------------------------*/
  if (arena.type === "quarter") {
    for (let i = 0; i < total; i++) {
      const p = arena.players[i];

      if (p.boosters.includes("immune")) {
        p.positionStatus = "immune";
        continue;
      }

      if (total < 6) {
        p.positionStatus = "alive";
        continue;
      }

      if (i <= 4) p.positionStatus = "alive";
      else if (i >= 5 && i <= 7) p.positionStatus = "danger";
      else p.positionStatus = "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* -------------------------------
     FINALE LOGICA — v15.2
     ✔ altijd bottom-1 danger
  --------------------------------*/
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.boosters.includes("immune")) {
      p.positionStatus = "immune";
      continue;
    }

    if (i === total - 1) p.positionStatus = "danger";
    else p.positionStatus = "alive";
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
  });
}

/* ============================================================================
   START ROUND
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  // Nieuwe ronde +1
  arena.round += 1;

  // Finale-detectie
  arena.type = type;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;

    emitLog({
      type: "arena",
      message: `⚡ Finale gestart op ronde #${arena.round}`,
    });
  }

  // Active
  arena.status = "active";
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
    message: `Ronde ${arena.round} gestart (${type}) — duur: ${duration}s`,
  });

  await emitArena();

  io.emit("round:start", {
    round: arena.round,
    type,
    duration,
  });
}

/* ============================================================================
   END ROUND — v15.2
   ✔ ACTIVE → GRACE
   ✔ GRACE → eliminaties volgens quarter of finale regels
============================================================================ */

export async function endRound() {
  /* -------------------------
     FASE 1: ACTIVE → GRACE
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
     FASE 2: GRACE → ENDED
  --------------------------*/
  if (arena.status === "grace") {
    arena.status = "ended";

    await recomputePositions();
    const total = arena.players.length;

    /* ============================
         SPECIALE FINALE LOGICA
       ============================ */
    if (arena.type === "finale") {
      if (total <= 1) {
        // Winnaar bekend
        emitLog({
          type: "arena",
          message: `🏆 Finale gewonnen door ${arena.players[0]?.display_name || "?"}`,
        });

        io.emit("round:end", {
          round: arena.round,
          type: arena.type,
          pendingEliminations: [],
          top3: arena.players.slice(0, 3),
          winner: arena.players[0] || null,
        });

        await emitArena();
        return;
      }

      // De laatste speler (lowest score) wordt geëlimineerd
      const doomed = [arena.players[total - 1]];

      doomed[0].positionStatus = "elimination";
      doomed[0].eliminated = true;

      emitLog({
        type: "arena",
        message: `🔥 Finale-eliminatie: ${doomed[0].display_name}`,
      });

      const top3 = arena.players.slice(0, 3).map((p) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        diamonds: p.score,
      }));

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: doomed.map((p) => p.username),
        top3,
      });

      await emitArena();
      return;
    }

    /* ============================
         QUARTER LOGICA (normaal)
       ============================ */

    if (total < 6) {
      // Geen eliminaties
      emitLog({
        type: "arena",
        message: `Ronde geëindigd — minder dan 6 spelers, geen eliminaties.`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3),
      });

      await emitArena();
      return;
    }

    // Quarter eliminaties 6–8 → indexes 5–7
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

    const top3 = arena.players.slice(0, 3).map((p) => ({
      id: p.id,
      username: p.username,
      display_name: p.display_name,
      diamonds: p.score,
    }));

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed.map((p) => p.username),
      top3,
    });

    await emitArena();
  }
  }

/* ============================================================================
   ARENA MANAGEMENT — JOIN / LEAVE
============================================================================ */

export async function arenaJoin(
  tiktok_id: string,
  display_name: string,
  username: string
) {
  const id = String(tiktok_id);

  if (arena.players.some((p) => p.id === id)) return;

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

export async function arenaLeave(tiktok_id: string) {
  const id = String(tiktok_id);

  const idx = arena.players.findIndex((p) => p.id === id);
  if (idx === -1) return;

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({ type: "elim", message: `${p.display_name} uit arena verwijderd` });

  await emitArena();
}

/* ============================================================================
   ADD BY USER LOOKUP
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
    message: `${user.display_name} toegevoegd aan arena`,
  });

  await emitArena();
}

/* ============================================================================
   ELIMINATE (MANUAL)
============================================================================ */

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex((p) => p.username.toLowerCase() === clean);
  if (idx === -1) throw new Error("Gebruiker zit niet in arena");

  const p = arena.players[idx];
  arena.players.splice(idx, 1);

  emitLog({ type: "elim", message: `${p.display_name} geëlimineerd` });

  await emitArena();
}

/* ============================================================================
   QUEUE → ARENA (auto join)
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
   ARENA CLEAR (total reset)
============================================================================ */

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;

  emitLog({
    type: "arena",
    message: "Arena gereset",
  });

  await emitArena();
}

/* ============================================================================
   FORCE SORT
============================================================================ */

export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

/* ============================================================================
   UPDATE SETTINGS
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
   TIMER LOOP — AUTO PROGRESSION
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
