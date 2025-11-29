/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v16 + Twist Integration v1.0
   ✔ Volgende volledig geïntegreerd:
     - MoneyGun (mark)
     - Bomb (random mark)
     - Immune (twist-immune)
     - Heal (remove MG/Bomb only)
     - DiamondPistol (exclusive round-wide eliminator)
     - Galaxy (reverse sort toggle)
   ✔ Volledige compatibiliteit met bestaande danger/finale/elimination logica
   ✔ Geen bestaande functies verwijderd
============================================================================ */

import pool from "../db";
import { io, emitLog } from "../server";

/* ============================================================================
   TYPES
============================================================================ */

export type ArenaStatus = "idle" | "active" | "grace" | "ended";
export type RoundType = "quarter" | "finale";

/** Extra twist-flags toegevoegd */
export interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;
  boosters: string[];

  positionStatus: "alive" | "danger" | "elimination" | "immune" | "shielded";
  eliminated?: boolean;

  /** Twist flags */
  markedMG?: boolean;       // MoneyGun mark
  markedBomb?: boolean;     // Bomb mark
  markedDP?: boolean;       // DiamondPistol hard-elimination mark
  immuneTwist?: boolean;    // Immune (twist) — blocks MG/Bomb/normal elim
  dpSurvivor?: boolean;     // DP target (cannot be eliminated this round)
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

  /** Twist-round flags */
  dpUsedThisRound?: boolean;
  galaxyReversed?: boolean;
}

/* ============================================================================
   INITIAL STATE
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

  /** Twist extensions */
  dpUsedThisRound: false,
  galaxyReversed: false,
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
   SCORE SYSTEM (ongewijzigd)
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
   RECOMPUTE POSITIONS (GEUPGRADED MET GALAXY-SORT)
============================================================================ */

async function recomputePositions() {
  const status = arena.status;
  const total = arena.players.length;

  // IDLE — unchanged
  if (status === "idle") {
    for (const p of arena.players) {
      p.score = 0;
      p.positionStatus = p.immuneTwist ? "immune" : "alive";
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  // SCORES ophalen
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // GALAXY SORT LOGICA
  if (arena.galaxyReversed) {
    arena.players.sort((a, b) => a.score - b.score); // reversed
  } else {
    arena.players.sort((a, b) => b.score - a.score); // normaal
  }

  // ENDED — only show elimination markers
  if (status === "ended") {
    for (const p of arena.players) {
      if (p.eliminated) p.positionStatus = "elimination";
      else if (p.immuneTwist) p.positionStatus = "immune";
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  /* -------------------------
     QUARTER danger logic
  ------------------------- */
  if (arena.type === "quarter") {
    if (total < 6) {
      for (const p of arena.players) {
        p.positionStatus = p.immuneTwist ? "immune" : "alive";
      }
      arena.lastSortedAt = Date.now();
      return;
    }

    const threshold = arena.players[5].score;
    for (const p of arena.players) {
      if (p.eliminated) {
        p.positionStatus = "elimination";
        continue;
      }
      if (p.immuneTwist) {
        p.positionStatus = "immune";
        continue;
      }
      p.positionStatus = p.score <= threshold ? "danger" : "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* -------------------------
     FINALE danger logic
  ------------------------- */
  for (let i = 0; i < total; i++) {
    const p = arena.players[i];

    if (p.eliminated) {
      p.positionStatus = "elimination";
      continue;
    }
    if (p.immuneTwist) {
      p.positionStatus = "immune";
      continue;
    }

    p.positionStatus = i === total - 1 ? "danger" : "alive";
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

    removeAllowed: arena.status === "idle" || arena.status === "ended",

    /** Twist flags */
    galaxyReversed: arena.galaxyReversed,
    dpUsedThisRound: arena.dpUsedThisRound,
  });
}

/* ============================================================================
   START ROUND (met twist-reset)
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  arena.round += 1;
  arena.type = type;

  if (type === "finale" && arena.firstFinalRound === null) {
    arena.firstFinalRound = arena.round;
    emitLog({
      type: "arena",
      message: `⚡ Finale gestart op ronde ${arena.round}`,
    });
  }

  // RESET ELIMINATIES EN TWISTS
  for (const p of arena.players) {
    p.positionStatus = "alive";
    p.eliminated = false;

    // Twist flags reset
    p.markedMG = false;
    p.markedBomb = false;
    p.markedDP = false;

    p.dpSurvivor = false;

    // Immune (twist) vervalt aan begin van ronde
    p.immuneTwist = false;
  }

  // Arena twist flags reset
  arena.dpUsedThisRound = false;
  // galaxyReversed blijft staan totdat een Galaxy opnieuw wordt gebruikt

  arena.status = "active";

  // Gift-engine aan
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
  });
}

/* ============================================================================
   END ROUND — Twist Elimination + Danger Elimination
============================================================================ */

export async function endRound(forceEnd: boolean = false) {
  // -----------------------------------------------------------
  // PHASE 1 — FORCE END (zelfde flow, maar direct naar ended)
  // -----------------------------------------------------------

  const performFinalEliminations = async () => {
    await recomputePositions();
    const total = arena.players.length;

    // ====== FINALE ======
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

      const lowestScore = arena.players[total - 1].score;
      const doomed = arena.players.filter((p) => p.score === lowestScore);

      for (const p of doomed) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminatie(s): ${doomed
          .map((x) => x.display_name)
          .join(", ")}`,
      });

      io.emit("round:end", {
        round: arena.round,
        type: "finale",
        pendingEliminations: doomed.map((x) => x.username),
        top3: arena.players.slice(0, 3),
      });

      await emitArena();
      return;
    }

    // ====== QUARTER ======
    const totalQ = arena.players.length;
    if (totalQ < 6) {
      io.emit("round:end", {
        round: arena.round,
        type: arena.type,
        pendingEliminations: [],
        top3: arena.players.slice(0, 3),
      });
      await emitArena();
      return;
    }

    const doomed = arena.players.filter((p) => p.positionStatus === "danger");

    for (const p of doomed) {
      p.positionStatus = "elimination";
      p.eliminated = true;
    }

    emitLog({
      type: "arena",
      message: `Force-end eliminaties: ${doomed.length}`,
    });

    io.emit("round:end", {
      round: arena.round,
      type: arena.type,
      pendingEliminations: doomed.map((x) => x.username),
      top3: arena.players.slice(0, 3),
    });

    await emitArena();
  };

  // -----------------------------------------------------------
  // FORCE-END => DIRECT DOOR
  // -----------------------------------------------------------
  if (forceEnd) {
    arena.status = "ended";
    (io as any).roundActive = false;

    // TWIST-ELIMS uitvoeren vóór de quarter/finale logica
    applyTwistEliminations();

    await performFinalEliminations();
    return;
  }

  // -----------------------------------------------------------
  // ACTIVE → GRACE
  // -----------------------------------------------------------
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

  // -----------------------------------------------------------
  // GRACE → ENDED
  // -----------------------------------------------------------
  if (arena.status === "grace") {
    arena.status = "ended";

    (io as any).roundActive = false;

    // TWIST-ELIMS uitvoeren vóór de quarter/finale regels
    applyTwistEliminations();

    await performFinalEliminations();
  }
}

/* ============================================================================
   TWIST ELIMINATION RESOLVER
   (Wordt ELKE ronde-eind gebruikt)
============================================================================ */

function applyTwistEliminations() {
  for (const p of arena.players) {
    // ----------------------------------------------------
    // DiamondPistol target → kan niet geëlimineerd worden
    // ----------------------------------------------------
    if (p.dpSurvivor) {
      p.eliminated = false;
      p.positionStatus = "alive";
      continue;
    }

    // ----------------------------------------------------
    // DP-mark = hard eliminate (immune/heal negeren)
    // ----------------------------------------------------
    if (p.markedDP) {
      p.eliminated = true;
      p.positionStatus = "elimination";
      continue;
    }

    // ====================================================
    // Twist Immune ondersteunt:  
    //  - blokkeert MG  
    //  - blokkeert Bomb  
    //  - blokkeert normale eliminaties  
    // ----------------------------------------------------
    if (p.immuneTwist) {
      p.eliminated = false;
      continue;
    }

    // ----------------------------------------------------
    // MG eliminate
    // ----------------------------------------------------
    if (p.markedMG) {
      p.eliminated = true;
      p.positionStatus = "elimination";
      continue;
    }

    // ----------------------------------------------------
    // BOMB eliminate
    // ----------------------------------------------------
    if (p.markedBomb) {
      p.eliminated = true;
      p.positionStatus = "elimination";
      continue;
    }
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

    // Twist flags default
    markedMG: false,
    markedBomb: false,
    markedDP: false,
    immuneTwist: false,
    dpSurvivor: false,
  });

  await emitArena();
}

export async function arenaLeave(usernameOrId: string, force: boolean = false) {
  const clean = String(usernameOrId).replace(/^@+/, "");
  const cleanLower = clean.toLowerCase();

  const idx = arena.players.findIndex(
    (p) => p.id === clean || p.username.toLowerCase() === cleanLower
  );

  if (idx === -1) return;

  const p = arena.players[idx];

  if (force) {
    // Permanente verwijdering
    arena.players.splice(idx, 1);

    emitLog({
      type: "elim",
      message: `${p.display_name} permanent verwijderd uit arena`,
    });

    await emitArena();
    return;
  }

  // Soft eliminate
  p.positionStatus = "elimination";
  p.eliminated = true;

  emitLog({
    type: "elim",
    message: `${p.display_name} gemarkeerd als eliminated`,
  });

  await emitArena();
}

/* ============================================================================
   OTHER ENTRYPOINTS
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

    markedMG: false,
    markedBomb: false,
    markedDP: false,
    immuneTwist: false,
    dpSurvivor: false,
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} handmatig toegevoegd aan arena`,
  });

  await emitArena();
}

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

export async function addFromQueue(user: any) {
  arena.players.push({
    id: String(user.tiktok_id),
    username: user.username.toLowerCase(),
    display_name: user.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",

    markedMG: false,
    markedBomb: false,
    markedDP: false,
    immuneTwist: false,
    dpSurvivor: false,
  });

  await emitArena();
}

/* ============================================================================
   CLEAR, SORT, SETTINGS
============================================================================ */

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;
  arena.dpUsedThisRound = false;
  // galaxyReversed blijft staan tot speler die twist opnieuw gebruikt

  emitLog({
    type: "arena",
    message: `Arena volledig gereset`,
  });

  await emitArena();
}

export async function forceSort() {
  await recomputePositions();
  await emitArena();
}

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
   TIMER LOOP — AUTO TRANSITIONS
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // ACTIVE → GRACE automatisch
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

  // GRACE → ENDED automatisch
  if (arena.status === "grace" && now >= arena.graceEnd) {
    await endRound(); // normale end, geen force
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
  endRound, // forceEnd wordt extern aangeroepen: endRound(true)

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
