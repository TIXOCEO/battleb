/* ============================================================================
   5-game-engine.ts — BATTLEBOX ENGINE v15-STABLE
   ----------------------------------------------------------------------------
   - Realtime arena engine
   - Eliminations + danger logic
   - Safe idle-join fix
   - Permanent vs soft removal
   - Correct round flow
============================================================================ */

import pool from "../db";
import { emitArena as emitArenaRaw } from "../sio";
import { emitLog } from "./7-logger";

// ---------------------------------------------------------
// ArenaState shape
// ---------------------------------------------------------
export type ArenaPlayerStatus =
  | "alive"
  | "eliminated"
  | "danger"
  | "immune"
  | "elimination";

export interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;
  boosters: string[];
  eliminated?: boolean;
  positionStatus: ArenaPlayerStatus;
  is_vip?: boolean;
  is_fan?: boolean;
}

export interface ArenaSettings {
  forceEliminations: boolean;
  autoDanger: boolean;
}

export interface ArenaState {
  players: ArenaPlayer[];

  round: number;
  type: "quarter" | "semi" | "finale";
  status: "idle" | "active" | "grace" | "ended";

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;
  lastSortedAt: number;

  settings: ArenaSettings;
}

// ---------------------------------------------------------
// Global arena (server memory)
// ---------------------------------------------------------
export const arena: ArenaState = {
  players: [],
  round: 1,
  type: "quarter",
  status: "idle",
  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,
  lastSortedAt: 0,
  settings: {
    forceEliminations: true,
    autoDanger: true,
  },
};

// ---------------------------------------------------------
// EMIT ARENA WRAPPER
// ---------------------------------------------------------
export async function emitArena() {
  return emitArenaRaw(arena);
}

// ---------------------------------------------------------
// SOFT REMOVE (mark elimination) OR HARD REMOVE (force)
// ---------------------------------------------------------
export async function arenaLeave(
  usernameOrId: string,
  force: boolean = false
) {
  const clean = String(usernameOrId).replace(/^@+/, "").toLowerCase();

  const idx = arena.players.findIndex(
    (p) =>
      p.id === clean ||
      p.username.toLowerCase() === clean
  );

  if (idx === -1) return;

  const p = arena.players[idx];

  // HARD DELETE
  if (force) {
    arena.players.splice(idx, 1);

    emitLog({
      type: "elim",
      message: `${p.display_name} permanent verwijderd uit arena`,
    });

    await emitArena();
    return;
  }

  // SOFT DELETE
  p.eliminated = true;
  p.positionStatus = "elimination";

  emitLog({
    type: "elim",
    message: `${p.display_name} gemarkeerd als eliminated`,
  });

  await emitArena();
}

// ---------------------------------------------------------
// ADD PLAYER TO ARENA (SAFE IDLE ROUND FIX)
// ---------------------------------------------------------
export async function arenaJoin(usernameOrId: string) {
  const clean = String(usernameOrId).replace(/^@+/, "").toLowerCase();

  const r = await pool.query(
    `SELECT tiktok_id, username, display_name
     FROM users
     WHERE LOWER(username)=LOWER($1)
     LIMIT 1`,
    [clean]
  );

  if (!r.rows.length) return;

  const row = r.rows[0];

  // Check duplicates
  if (arena.players.some((p) => p.id === String(row.tiktok_id))) return;

  // NEW FIX → Player SHOULD NOT inherit previous round state.
  // If arena is idle → always insert as fresh
  const player: ArenaPlayer = {
    id: String(row.tiktok_id),
    username: row.username,
    display_name: row.display_name,
    score: 0,
    boosters: [],
    eliminated: false,
    positionStatus: "alive",
    is_vip: false,
    is_fan: false,
  };

  arena.players.push(player);

  emitLog({
    type: "join",
    message: `${player.display_name} toegevoegd aan arena`,
  });

  await emitArena();
}

// ---------------------------------------------------------
// CLEAR ARENA
// ---------------------------------------------------------
export async function arenaClear() {
  arena.players = [];
  arena.round = 1;
  arena.type = "quarter";
  arena.status = "idle";

  emitLog({
    type: "sys",
    message: "Arena volledig geleegd",
  });

  await emitArena();
}

// ---------------------------------------------------------
// SORTING + DANGER LOGIC FOR FINAL ROUND
// ---------------------------------------------------------
export function resortPlayers() {
  // Sort by score descending
  arena.players.sort((a, b) => b.score - a.score);

  // Apply position statuses
  for (let p of arena.players) {
    if (p.eliminated) {
      p.positionStatus = "elimination";
    } else {
      p.positionStatus = "alive";
    }
  }

  // FINAL ROUND → lowest score goes "danger"
  if (arena.type === "finale" && arena.status !== "idle") {
    let active = arena.players.filter((p) => !p.eliminated);
    if (active.length > 1) {
      let last = active[active.length - 1];
      last.positionStatus = "danger";
    }
  }

  arena.lastSortedAt = Date.now();
}

// ---------------------------------------------------------
// ROUND START
// ---------------------------------------------------------
export async function startRound(type: "quarter" | "semi" | "finale") {
  // Final round type persists
  if (type) arena.type = type;

  arena.status = "active";
  arena.roundStartTime = Date.now();
  arena.roundCutoff = arena.roundStartTime + 30_000; // 30 sec base
  arena.graceEnd = arena.roundCutoff + 10_000;

  emitLog({
    type: "sys",
    message: `Ronde gestart (${arena.type})`,
  });

  resortPlayers();
  await emitArena();
}

// ---------------------------------------------------------
// END ROUND → go to grace
// ---------------------------------------------------------
export async function endRound() {
  if (arena.status !== "active") return;

  arena.status = "grace";

  emitLog({
    type: "sys",
    message: "Ronde beëindigd — grace fase",
  });

  resortPlayers();
  await emitArena();
}

// ---------------------------------------------------------
// END GRACE → elimination phase
// ---------------------------------------------------------
export async function endGrace() {
  if (arena.status !== "grace") return;

  arena.status = "ended";

  emitLog({
    type: "sys",
    message: "Grace voorbij — eliminatiefase",
  });

  // Apply elimination markers again
  for (const p of arena.players) {
    if (p.eliminated) {
      p.positionStatus = "elimination";
    } else if (arena.type === "finale") {
      // FINAL ROUND: lowest = danger
      // This is re-applied in resortPlayers()
    }
  }

  resortPlayers();
  await emitArena();
}

/* ============================================================================
   5-game-engine.ts — DEEL 2/2
   BattlBox Engine v15-STABLE
============================================================================ */

import { io } from "../server";
import pool from "../db";
import { emitLog } from "./7-logger";
import { arena } from "./5-game-engine"; // continuation requires circular-safe import

// ---------------------------------------------------------
// SCORE HELPERS
// ---------------------------------------------------------

async function getRoundScore(tiktokId: string, round: number) {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

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

async function getTotalFinalScore(tiktokId: string) {
  const gid = (io as any)?.currentGameId;
  if (!gid) return 0;

  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1
        AND game_id=$2
        AND is_round_gift=TRUE
    `,
    [BigInt(tiktokId), gid]
  );

  return Number(q.rows[0]?.score || 0);
}

// ---------------------------------------------------------
// RECOMPUTE PLAYER SCORES + STATUSES
// ---------------------------------------------------------

export async function recomputePositionsFull() {
  if (arena.status === "idle") {
    for (const p of arena.players) {
      p.score = 0;
      p.positionStatus = p.eliminated ? "elimination" : "alive";
    }
    arena.lastSortedAt = Date.now();
    return;
  }

  // Scores
  for (const p of arena.players) {
    if (arena.type === "finale") {
      p.score = await getTotalFinalScore(p.id);
    } else {
      p.score = await getRoundScore(p.id, arena.round);
    }
  }

  // Sort by score
  arena.players.sort((a, b) => b.score - a.score);

  // Status assignment baseline
  for (const p of arena.players) {
    if (p.eliminated) {
      p.positionStatus = "elimination";
    } else {
      p.positionStatus = "alive";
    }
  }

  // Quarter rules
  if (arena.type === "quarter" && arena.players.length >= 6) {
    arena.players.forEach((p, i) => {
      if (p.eliminated) return;

      if (i >= 5 && i <= 7) {
        p.positionStatus = "danger";
      } else {
        p.positionStatus = "alive";
      }
    });
  }

  // Final rules
  if (arena.type === "finale") {
    const active = arena.players.filter((x) => !x.eliminated);
    if (active.length > 1) {
      const last = active[active.length - 1];
      last.positionStatus = "danger";
    }
  }

  arena.lastSortedAt = Date.now();
}

// ---------------------------------------------------------
// EMIT-AFTER-RECOMPUTE WRAPPER
// ---------------------------------------------------------

export async function emitArenaFinal() {
  await recomputePositionsFull();

  io.emit("updateArena", {
    players: arena.players,
    round: arena.round,
    type: arena.type,
    status: arena.status,
    roundStartTime: arena.roundStartTime,
    roundCutoff: arena.roundCutoff,
    graceEnd: arena.graceEnd,
    settings: arena.settings,
    lastSortedAt: arena.lastSortedAt,
  });
}

// ---------------------------------------------------------
// END FINAL ROUND (winner)
// ---------------------------------------------------------

export async function finishFinalRound() {
  const alive = arena.players.filter((p) => !p.eliminated);
  if (alive.length <= 1) {
    const winner = alive[0] || null;

    emitLog({
      type: "sys",
      message: `🏆 Finale winnaar: ${winner?.display_name || "???"}`,
    });

    io.emit("round:end", {
      type: "finale",
      winner,
      top3: arena.players.slice(0, 3),
    });

    arena.status = "ended";
    await emitArenaFinal();
  }
}

// ---------------------------------------------------------
// GLOBAL TIMER LOOP
// ---------------------------------------------------------

setInterval(async () => {
  if (arena.status === "idle") return;

  const now = Date.now();

  // Active → Grace
  if (arena.status === "active" && now >= arena.roundCutoff) {
    arena.status = "grace";

    emitLog({
      type: "sys",
      message: "⏳ Automatische overgang → Grace",
    });

    io.emit("round:grace", {
      round: arena.round,
      grace: arena.graceEnd - arena.roundCutoff,
    });

    await emitArenaFinal();
    return;
  }

  // Grace → Ended
  if (arena.status === "grace" && now >= arena.graceEnd) {
    arena.status = "ended";

    emitLog({
      type: "sys",
      message: "🔚 Grace voorbij → Eliminaties",
    });

    await recomputePositionsFull();

    // Quarter elimination
    if (arena.type === "quarter") {
      const doomed = arena.players.filter(
        (p, i) => i >= 5 && i <= 7 && !p.eliminated
      );

      for (const p of doomed) {
        p.eliminated = true;
        p.positionStatus = "elimination";
      }

      io.emit("round:end", {
        round: arena.round,
        type: "quarter",
        pendingEliminations: doomed.map((p) => p.username),
      });
    }

    // Final elimination
    if (arena.type === "finale") {
      const active = arena.players.filter((p) => !p.eliminated);
      if (active.length > 1) {
        const last = active[active.length - 1];
        last.eliminated = true;
        last.positionStatus = "elimination";

        io.emit("round:end", {
          round: arena.round,
          type: "finale",
          pendingEliminations: [last.username],
          top3: arena.players.slice(0, 3),
        });
      }

      await finishFinalRound();
    }

    await emitArenaFinal();
    return;
  }
}, 1000);

// ---------------------------------------------------------
// EXPORT DEFAULT
// ---------------------------------------------------------

export default {
  arena,
  arenaJoin,
  arenaLeave,
  arenaClear,
  startRound,
  endRound,
  endGrace,
  recomputePositionsFull,
  resortPlayers,
  emitArena: emitArenaFinal,
  finishFinalRound,
};
