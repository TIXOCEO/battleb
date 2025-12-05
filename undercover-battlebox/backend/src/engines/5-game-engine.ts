/* ============================================================================
   5-game-engine.ts — BattleBox Arena Engine v16.4 (PATCHED ARENA-LEAVE FIX)
   (Galaxy Reverse + DiamondPistol 1-per-Round Patch + Breaker Support)

   ✔ Immune = 1 ronde geldig
   ✔ Survivor immune = 1 ronde geldig
   ✔ MoneyGun/Bomb markeringen = eliminated=true
   ✔ Heal verwijdert eliminated + mg/bomb badges
   ✔ EndRound verwerkt eerst MG/Bomb, daarna danger/ties
   ✔ reverseMode ondersteunt Galaxy twist
   ✔ toggleGalaxyMode() toegevoegd voor Twist Engine v15
   ✔ Diamond Pistol nu max 1x per ronde
   ✔ Breaker ondersteuning (breakerHits)

   === PATCHES TOEGEVOEGD ===
   ✔ PATCH A — arenaLeave(): verbeterde ID/username/display matching
   ✔ PATCH B — removeAllowed: altijd true (frontend blokkeerde verwijderen)
   ✔ PATCH C — robust fallback matching en race-fix tijdens verwijderen
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

  /** PATCH: support voor breaker 50%/100% immunity break */
  breakerHits?: number;
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

  // ★ GALAXY — sort omkeren
  reverseMode: boolean;

  // ★ DIAMOND PISTOL — max 1 per ronde
  diamondPistolUsed: boolean;
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

  reverseMode: false,

  diamondPistolUsed: false,
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
      WHERE receiver_id=$1
        AND game_id=$2
        AND round_id < $3
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid, first]
  );

  const finale = await pool.query(
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

  return Number(base.rows[0].score) + Number(finale.rows[0].score);
}

async function computePlayerScore(p: ArenaPlayer) {
  if (arena.status === "idle") return 0;

  if (arena.type === "finale") return await getFinalScore(p.id);
  return await getRoundScore(p.id, arena.round);
}

/* ============================================================================
   RECOMPUTE POSITIONS — inclusief reverseMode
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

  // SCORES HERBEREKENEN
  for (const p of arena.players) {
    p.score = await computePlayerScore(p);
  }

  // reverse sorting
  if (arena.reverseMode) {
    arena.players.sort((a, b) => a.score - b.score);
  } else {
    arena.players.sort((a, b) => b.score - a.score);
  }

  if (status === "ended") {
    for (const p of arena.players) {
      if (p.eliminated) p.positionStatus = "elimination";
      else if (p.tempImmune || p.survivorImmune) p.positionStatus = "immune";
      else if (p.boosters.includes("immune")) p.positionStatus = "immune";
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  // QUARTER LOGICA
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

    let threshold: number;

    if (arena.reverseMode) {
      threshold = arena.players[5].score;
      for (const p of arena.players) {
        if (p.eliminated) p.positionStatus = "elimination";
        else if (p.tempImmune || p.survivorImmune) p.positionStatus = "immune";
        else if (p.boosters.includes("immune")) p.positionStatus = "immune";
        else p.positionStatus = p.score >= threshold ? "danger" : "alive";
      }
    } else {
      threshold = arena.players[5].score;
      for (const p of arena.players) {
        if (p.eliminated) p.positionStatus = "elimination";
        else if (p.tempImmune || p.survivorImmune) p.positionStatus = "immune";
        else if (p.boosters.includes("immune")) p.positionStatus = "immune";
        else p.positionStatus = p.score <= threshold ? "danger" : "alive";
      }
    }

    arena.lastSortedAt = Date.now();
    return;
  }

  // FINALE LOGICA
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

    if (arena.reverseMode) {
      p.positionStatus = i === 0 ? "danger" : "alive";
    } else {
      p.positionStatus = i === totalFinal - 1 ? "danger" : "alive";
    }
  }

  arena.lastSortedAt = Date.now();
}

/* ============================================================================
   EMIT SNAPSHOT — NIEUW HUD + PLAYER PAYLOAD (overlay v2)
============================================================================ */

export async function emitArena() {
  await recomputePositions();

  // -------------------------------------------------------------
  // 1) HUD BOUWEN
  // -------------------------------------------------------------
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
    roundNumber: arena.round,
    roundType: arena.type,
    roundStatus: arena.status,
    reverseMode: arena.reverseMode,

    remainingMs,
    totalMs,

    // eventueel later handig voor animaties
    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,
  };

  // -------------------------------------------------------------
  // 2) PLAYERS MAPPEN → overlay structuur
  // -------------------------------------------------------------
  const players = arena.players.map((p) => ({
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    score: p.score,

    positionStatus: p.positionStatus,
    eliminated: !!p.eliminated,

    // booster info
    tempImmune: !!p.tempImmune,
    survivorImmune: !!p.survivorImmune,
    breakerHits: p.breakerHits ?? 0,

    // we sturen geen boosters-array meer, alleen flags
    boosters: p.boosters,
  }));

  // -------------------------------------------------------------
  // 3) BROADCAST NAAR ALLE OVERLAYS
  // -------------------------------------------------------------
  io.emit("updateArena", {
    hud,
    players,

    // overige bestaande properties blijven voor admin-dashboard
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

/* ============================================================================
   toggleGalaxyMode() — Galaxy UNO-reverse
============================================================================ */

export function toggleGalaxyMode(): boolean {
  arena.reverseMode = !arena.reverseMode;

  emitLog({
    type: "twist",
    message: `GALAXY toggle → reverseMode = ${
      arena.reverseMode ? "AAN" : "UIT"
    }`,
  });

  return arena.reverseMode;
}

/* ============================================================================
   START ROUND
============================================================================ */

export async function startRound(type: RoundType) {
  if (!arena.players.length) throw new Error("Geen spelers in arena!");

  arena.round += 1;
  arena.type = type;

  // RESET GALAXY
  arena.reverseMode = false;

  // RESET DIAMOND PISTOL limiter
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

    // --- PATCH: reset breaker hits ---
    p.breakerHits = 0;

    // immune opschonen
    p.boosters = p.boosters.filter((b) => b !== "immune");

    // remove mg/bomb badges
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

/* ============================================================================
   END ROUND — MG/Bomb → danger/ties → eliminaties
============================================================================ */

export async function endRound(forceEnd: boolean = false) {
  // ---------------------------------------------------------
  // FORCE STOP
  // ---------------------------------------------------------
  if (forceEnd) {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();
    const total = arena.players.length;

    // ======= FINALE FORCE END =======
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

      const lowest =
        arena.players[arena.reverseMode ? 0 : total - 1].score;

      const doomed = arena.players.filter((p) => p.score === lowest);

      for (const p of doomed) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminaties: ${doomed
          .map((x) => x.display_name)
          .join(", ")}`,
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

    // ======= QUARTER FORCE END =======
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

  // ---------------------------------------------------------
  // ACTIVE → GRACE
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // GRACE → END
  // ---------------------------------------------------------
  if (arena.status === "grace") {
    arena.status = "ended";
    (io as any).roundActive = false;

    await recomputePositions();
    const total = arena.players.length;

    const doomedMG = arena.players.filter((p) => p.eliminated);

    if (arena.type === "finale") {
      if (doomedMG.length) {
        emitLog({
          type: "arena",
          message: `💀 MG/Bomb eliminaties: ${doomedMG
            .map((x) => x.display_name)
            .join(", ")}`,
        });

        io.emit("round:end", {
          round: arena.round,
          type: arena.type,
          pendingEliminations: doomedMG.map((x) => x.username),
          top3: arena.players.slice(0, 3),
          reverseMode: arena.reverseMode,
        });

        await emitArena();
        return;
      }

      const index = arena.reverseMode ? 0 : total - 1;
      const lowest = arena.players[index].score;
      const doomedTie = arena.players.filter((p) => p.score === lowest);

      for (const p of doomedTie) {
        p.positionStatus = "elimination";
        p.eliminated = true;
      }

      emitLog({
        type: "arena",
        message: `🔥 Finale eliminaties (tie): ${doomedTie
          .map((x) => x.display_name)
          .join(", ")}`,
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

    const doomedDanger =
      arena.settings.forceEliminations &&
      arena.players.filter((p) => p.positionStatus === "danger");

    const doomed = [
      ...doomedMG.map((x) => x.username),
      ...(doomedDanger || []).map((x) => x.username),
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

/* ============================================================================
   ARENA MANAGEMENT — VERWIJDER-PATCHES HIERONDER
============================================================================ */

export async function arenaJoin(id: string, display_name: string, username: string) {
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
  });

  await emitArena();
}

/* ============================================================================
   PATCHED arenaLeave() — robuuste verwijdering op id/username/display
============================================================================ */

export async function arenaLeave(identifier: string, force: boolean = false) {
  const raw = String(identifier).replace(/^@+/, "").trim();
  const lower = raw.toLowerCase();

  const idx = arena.players.findIndex((p) => {
    return (
      p.id === raw ||
      p.id === lower ||
      p.username?.toLowerCase() === lower ||
      p.display_name?.toLowerCase() === lower
    );
  });

  if (idx === -1) return;

  const p = arena.players[idx];

  if (force) {
    arena.players.splice(idx, 1);

    emitLog({
      type: "elim",
      message: `${p.display_name} permanent verwijderd uit arena`,
    });

    await emitArena();
    return;
  }

  p.positionStatus = "elimination";
  p.eliminated = true;

  emitLog({
    type: "elim",
    message: `${p.display_name} gemarkeerd als eliminated`,
  });

  await emitArena();
}

/* ============================================================================
   addToArena
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
    tempImmune: false,
    survivorImmune: false,
    breakerHits: 0,
  });

  emitLog({
    type: "arena",
    message: `${user.display_name} handmatig toegevoegd aan arena`,
  });

  await emitArena();
}

/* ============================================================================
   eliminate (hard remove)
============================================================================ */

export async function eliminate(username: string) {
  const clean = username.replace(/^@+/, "").lowerCase();

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
   arenaClear
============================================================================ */

export async function arenaClear() {
  arena.players = [];
  arena.round = 0;
  arena.status = "idle";
  arena.firstFinalRound = null;
  arena.reverseMode = false;
  arena.diamondPistolUsed = false;

  emitLog({
    type: "arena",
    message: `Arena volledig gereset`,
  });

  await emitArena();
}

/* ============================================================================
   addFromQueue (originele compat-logica)
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

  // fallback
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
    ...partial,
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
      arena.settings.graceSeconds,
    ]
  );

  await emitArena();
}

/* ============================================================================
   TICK — automatische overgang naar GRACE/ENDED
============================================================================ */

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "arena",
      message: "⏳ Automatische overgang naar GRACE",
    });

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
    return;
  }
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
  toggleGalaxyMode,
};
