/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v16.3 (Galaxy Reverse Mode)
   ✔ Exact gebaseerd op jouw v16.2
   ✔ Immune = 1 ronde geldig
   ✔ Survivor immune (DiamondPistol) = 1 ronde geldig
   ✔ MoneyGun/Bomb markeringen = p.eliminated=true (tot nieuwe ronde)
   ✔ EndRound verwerkt eerst MG/Bomb, daarna danger/ties
   ✔ Extra helpers: forceSort, addFromQueue, updateArenaSettings
   ✔ [MG] / [BOMB] badges reset bij startRound()
   -----------------------------------------------
   ★ Toegevoegd voor Galaxy:
   - reverseMode:boolean in arena-state
   - toggleGalaxyMode() functie
   - sortering omgekeerd wanneer reverseMode actief
   - reverseMode meegestuurd in updateArena()
   - reverseMode reset in startRound()
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

  /* ★ GALAXY REVERSE MODE */
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

  /* ★ Standaard niet reversed */
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
   RECOMPUTE POSITIONS + ★ GALAXY SORT
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

  /* ============================================================
     ★ GALAXY — reverse sort
     normaal: hoog → laag
     reverse: laag → hoog
  ============================================================ */
  if (arena.reverseMode) {
    arena.players.sort((a, b) => a.score - b.score);
  } else {
    arena.players.sort((a, b) => b.score - a.score);
  }

  /* ==== STATUS BIJ ENDED ==== */
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

  /* QUARTER LOGICA */
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

      /* ★ DANGER blijft onderaan, lijst is al reversed indien nodig */
      p.positionStatus = p.score <= threshold ? "danger" : "alive";
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  /* FINALE */
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

    /* Laatste plek = danger (lijst is reversed indien nodig) */
    p.positionStatus = i === totalFinal - 1 ? "danger" : "alive";
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT SNAPSHOT (+ reverseMode)
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

    /* ★ stuur reverseMode naar frontend */
    reverseMode: arena.reverseMode,

    removeAllowed: arena.status === "idle" || arena.status === "ended"
  });
}

export async function forceSort() {
  await emitArena();
}

/* ============================================================================
   ★ GALAXY — toggle functie
============================================================================ */

export function toggleGalaxyMode() {
  arena.reverseMode = !arena.reverseMode;

  emitLog({
    type: "twist",
    message: arena.reverseMode
      ? "🌀 Galaxy geactiveerd — ranking omgedraaid!"
      : "🌀 Galaxy opnieuw gebruikt — ranking hersteld!"
  });

  emitArena();
}

/* ============================================================================
   START ROUND (reset reverseMode)
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  arena.round += 1;
  arena.type = type;

  /* ★ ALTijd reset bij nieuwe ronde */
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
   END ROUND — volledig identiek aan jouw v16.2
   (GEEN wijzigingen nodig voor Galaxy)
============================================================================ */

export async function endRound(forceEnd: boolean = false) {
  /* ... volledig identiek ... */
  /* wegens lengte laat ik dat hier weg,
     maar in de volgende delen (deel 2+3)
     stuur ik het 100% volledig zoals in jouw bron. */
}

/* ============================================================================
   ARENA MANAGEMENT (identiek)
============================================================================ */

export async function arenaJoin(tiktok_id: string, display_name: string, username: string) {
  /* ... identiek ... */
}

export async function arenaLeave(usernameOrId: string, force: boolean = false) {
  /* ... identiek ... */
}

export async function addToArena(username: string, resolveUser: Function) {
  /* ... identiek ... */
}

export async function eliminate(username: string) {
  /* ... identiek ... */
}

export async function arenaClear() {
  /* ... identiek ... */
}

/* ============================================================================
   addFromQueue (identiek)
============================================================================ */

export async function addFromQueue(...args: any[]) {
  /* ... identiek ... */
}

/* ============================================================================
   updateArenaSettings (identiek)
============================================================================ */

export async function updateArenaSettings(partial: Partial<ArenaSettings>) {
  /* ... identiek ... */
}

/* ============================================================================
   TICK (identiek)
============================================================================ */

setInterval(async () => {
  /* ... identiek ... */
}, 1000);

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

  forceSort,

  /* ★ Galaxy toggle exporteren */
  toggleGalaxyMode
};

/* ============================================================================
   END ROUND — MoneyGun/Bomb + Survivor Immune verwerking
   (Volledig ongewijzigd behalve formatting)
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
   ARENA MANAGEMENT
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
    tempImmune: false,
    survivorImmune: false
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
    arena.players.splice(idx, 1);

    emitLog({
      type: "elim",
      message: `${p.display_name} permanent verwijderd uit arena`
    });

    await emitArena();
    return;
  }

  // Soft eliminate
  p.positionStatus = "elimination";
  p.eliminated = true;

  emitLog({
    type: "elim",
    message: `${p.display_name} gemarkeerd als eliminated`
  });

  await emitArena();
}

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
    tempImmune: false,
    survivorImmune: false
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} handmatig toegevoegd aan arena`
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
    message: `${p.display_name} handmatig geëlimineerd`
  });

  await emitArena();
}

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;
  arena.reverseMode = false; // ★ reset voor Galaxy

  emitLog({
    type: "arena",
    message: `Arena volledig gereset`
  });

  await emitArena();
           }

/* ============================================================================
   addFromQueue
============================================================================ */

export async function addFromQueue(...args: any[]) {
  if (!args.length) return;

  const candidate = args[0];
  if (
    candidate &&
    typeof candidate === "object" &&
    ("tiktok_id" in candidate || "user_tiktok_id" in candidate)
  ) {
    const id = String(
      (candidate as any).tiktok_id ?? (candidate as any).user_tiktok_id
    );
    const username: string =
      (candidate as any).username ??
      (candidate as any).user_username ??
      "";
    const display_name: string =
      (candidate as any).display_name ??
      (candidate as any).user_display_name ??
      username;

    return arenaJoin(id, display_name, username);
  }

  if (typeof args[0] === "string") {
    const id = String(args[0]);
    const display_name = String(args[1] ?? args[2] ?? "Unknown");
    const username = String(args[2] ?? args[1] ?? "unknown");
    return arenaJoin(id, display_name, username);
  }
}

/* ============================================================================
   updateArenaSettings
============================================================================ */

export async function updateArenaSettings(
  partial: Partial<ArenaSettings>
) {
  arena.settings = {
    ...arena.settings,
    ...partial
  };

  await pool.query(
    `
    UPDATE arena_settings
    SET round_pre_seconds = $1,
        round_final_seconds = $2,
        grace_seconds = $3
    `,
    [
      arena.settings.roundDurationPre,
      arena.settings.roundDurationFinal,
      arena.settings.graceSeconds
    ]
  );

  await emitArena();
}

/* ============================================================================
   TICK — auto ACTIVE→GRACE en GRACE→ENDED
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // ACTIVE → GRACE
  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: "⏳ Automatische overgang naar GRACE"
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.settings.graceSeconds
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
   EXPORT DEFAULT (volledig, met Galaxy reset)
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
