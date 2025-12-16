// ============================================================================
// 8-twist-engine.ts — Twist Engine v8.1 (Patched Build)
// ANIMATION-SAFE VERSION — waits for frontend animation to finish
// ============================================================================
//
// FIXES IN THIS PASS (NO FEATURE CHANGES):
// ✔ pending race hardening (single active twist)
// ✔ finalize handlers are idempotent-safe
// ✔ DiamondPistol ignores immune (apply + finalize consistent)
// ✔ Immune never revives, Heal is the only revive
// ✔ MoneyGun / Bomb are mark-only until finalize
//
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  toggleGalaxyMode
} from "./5-game-engine";

import {
  consumeTwistFromUser,
  giveTwistToUser
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  resolveTwistAlias
} from "./twist-definitions";

import pool from "../db";

// ============================================================================
// HELPERS
// ============================================================================
async function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

async function findUser(raw: string): Promise<any | null> {
  const clean = raw.replace("@", "").trim().toLowerCase();

  const q = await pool.query(
    `SELECT tiktok_id, username, display_name
     FROM users
     WHERE LOWER(username)=LOWER($1)
     LIMIT 1`,
    [clean]
  );

  if (!q.rows.length) return null;

  return {
    id: q.rows[0].tiktok_id.toString(),
    username: q.rows[0].username.replace(/^@/, ""),
    display_name: q.rows[0].display_name
  };
}

function getPlayerIndex(id: string): number {
  return getArena().players.findIndex(p => p.id === id);
}

// ============================================================================
// CLEAN emitTwistStart (UNCHANGED)
// ============================================================================
function emitTwistStart(type: TwistType, data: any = {}) {
  const title = data.by
    ? `${data.by} gebruikt ${type}`.toUpperCase()
    : type.toUpperCase();

  io.emit("twist:takeover", {
    type,
    title,
    ...data
  });
}

// ============================================================================
// ANIMATION GATE (SINGLE SOURCE OF TRUTH)
// ============================================================================
interface PendingTwist {
  type: TwistType;
  senderId: string;
  senderName: string;
  targetId?: string | null;
  victimIds?: string[] | null;
}

let pending: PendingTwist | null = null;

// ============================================================================
// SOCKET INIT (SAFE FINALIZE)
// ============================================================================
export function initTwistEngine() {
  io.on("connection", (socket) => {
    socket.on(
      "twist:animation-complete",
      async (payload?: { type?: TwistType; targetId?: string }) => {
        if (!pending) return;

        // Hard guards against mismatched / duplicate completes
        if (payload?.type && payload.type !== pending.type) return;
        if (
          payload?.targetId &&
          pending.targetId &&
          payload.targetId !== pending.targetId
        ) {
          return;
        }

        const p = pending;
        pending = null;

        switch (p.type) {
          case "bomb": await finalizeBomb(p); break;
          case "moneygun": await finalizeMoneyGun(p); break;
          case "immune": await finalizeImmune(p); break;
          case "heal": await finalizeHeal(p); break;
          case "diamondpistol": await finalizeDiamondPistol(p); break;
          case "breaker": await finalizeBreaker(p); break;
        }

        io.emit("twist:finish", {
          type: p.type,
          targetId: p.targetId
        });
      }
    );
  });
}

// ============================================================================
// FINALIZERS (DETERMINISTIC, NO REVIVES EXCEPT HEAL)
// ============================================================================
async function finalizeBomb(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || pl.eliminated) return;

  pl.positionStatus = "elimination";
  pl.eliminated = true;

  emitLog({
    type: "twist",
    message: `${p.senderName} BOMB → ${pl.display_name} geëlimineerd`
  });

  await emitArena();
}

async function finalizeMoneyGun(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || pl.eliminated) return;

  pl.positionStatus = "elimination";
  pl.eliminated = true;

  emitLog({
    type: "twist",
    message: `${p.senderName} MoneyGun → ${pl.display_name} geëlimineerd`
  });

  await emitArena();
}

async function finalizeImmune(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || pl.eliminated) return;

  if (!pl.boosters.includes("immune")) {
    pl.boosters.push("immune");
  }

  pl.positionStatus = "immune";

  emitLog({
    type: "twist",
    message: `${p.senderName} IMMUNE → ${pl.display_name}`
  });

  await emitArena();
}

async function finalizeHeal(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || !pl.eliminated) return;

  pl.eliminated = false;
  pl.positionStatus = "alive";
  pl.boosters = pl.boosters.filter(b => !["mg", "bomb"].includes(b));

  emitLog({
    type: "twist",
    message: `${p.senderName} HEAL → ${pl.display_name}`
  });

  await emitArena();
}

async function finalizeDiamondPistol(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const survivor = arena.players.find(x => x.id === p.targetId);
  if (!survivor) return;

  // immune always applied to survivor, regardless of previous immune state
  if (!survivor.boosters.includes("immune")) {
    survivor.boosters.push("immune");
  }
  survivor.positionStatus = "immune";

  for (const vid of p.victimIds ?? []) {
    const v = arena.players.find(x => x.id === vid);
    if (!v || v.eliminated) continue;

    v.positionStatus = "elimination";
    v.eliminated = true;
  }

  emitLog({
    type: "twist",
    message: `${p.senderName} DIAMOND PISTOL → ${survivor.display_name} overleeft`
  });

  await emitArena();
}

async function finalizeBreaker(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || pl.eliminated) return;

  pl.breakerHits = (pl.breakerHits ?? 0) + 1;

  if (pl.breakerHits >= 2) {
    pl.boosters = pl.boosters.filter(b => b !== "immune");
    pl.positionStatus = "alive";
  }

  emitLog({
    type: "twist",
    message: `${p.senderName} BREAKER → ${pl.display_name}`
  });

  await emitArena();
}

// ============================================================================
// TWIST APPLY FUNCTIONS
// ============================================================================

// ------------------------------ GALAXY -----------------------------------
async function applyGalaxy(senderId: string, senderName: string): Promise<void> {
  const ok = await consumeTwistFromUser(senderId, "galaxy");
  if (!ok) return;

  const reversed = toggleGalaxyMode();

  emitTwistStart("galaxy", { by: senderName, reversed });

  emitLog({
    type: "twist",
    message: `${senderName} GALAXY → ranking ${reversed ? "omgekeerd" : "normaal"}`
  });

  await emitArena();
}

// ------------------------------ MONEY GUN --------------------------------
async function applyMoneyGun(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  // mark-only → immune blocks
  if (p.boosters.includes("immune")) {
    emitLog({
      type: "twist",
      message: `${senderName} MoneyGun → ${p.display_name} is IMMUNE`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "moneygun");
  if (!ok) return;

  pending = {
    type: "moneygun",
    senderId,
    senderName,
    targetId: p.id
  };

  emitTwistStart("moneygun", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} MoneyGun gestart → ${p.display_name}`
  });

  // -----------------------------------------------------------------------
  // ⛑️ SAFETY FALLBACK — voorkomt permanente pending-lock
  // -----------------------------------------------------------------------
  setTimeout(async () => {
    if (!pending) return;
    if (pending.type !== "moneygun") return;
    if (pending.targetId !== p.id) return;

    emitLog({
      type: "twist",
      message: `MoneyGun fallback finalize (no animation-complete)`
    });

    const snap = pending;
    pending = null;

    await finalizeMoneyGun(snap);

    io.emit("twist:finish", {
      type: "moneygun",
      targetId: snap.targetId
    });
  }, 3500); // > animatieduur
}

// --------------------------------- BOMB ---------------------------------
let bombInProgress = false;

async function applyBomb(senderId: string, senderName: string) {
  if (bombInProgress) {
    emitLog({ type: "twist", message: `${senderName} Bomb → bezig…` });
    return;
  }

  const arena = getArena();
  const candidates = arena.players.filter(
    p => !p.boosters.includes("immune") && !p.eliminated
  );

  if (!candidates.length) {
    emitLog({
      type: "twist",
      message: `${senderName} Bomb → geen geldige targets`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "bomb");
  if (!ok) return;

  bombInProgress = true;

  const target = candidates[Math.floor(Math.random() * candidates.length)];

  pending = {
    type: "bomb",
    senderId,
    senderName,
    targetId: target.id
  };

  emitTwistStart("bomb", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} BOMB animatie gestart → ${target.display_name}`
  });

  await sleep(2000);
  bombInProgress = false;
}

// -------------------------------- IMMUNE ---------------------------------
async function applyImmuneTwist(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  // ❌ immune mag NOOIT revive zijn
  if (p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} IMMUNE geblokkeerd → ${p.display_name} is eliminated`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "immune");
  if (!ok) return;

  pending = {
    type: "immune",
    senderId,
    senderName,
    targetId: p.id
  };

  emitTwistStart("immune", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} IMMUNE gestart → ${p.display_name}`
  });
}

// -------------------------------- HEAL -----------------------------------
async function applyHeal(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p || !p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} Heal → ${p?.display_name} is niet eliminated`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "heal");
  if (!ok) return;

  pending = {
    type: "heal",
    senderId,
    senderName,
    targetId: p.id
  };

  emitTwistStart("heal", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} HEAL gestart → ${p.display_name}`
  });

  // -----------------------------------------------------------------------
  // ⛑️ SAFETY FALLBACK — voorkomt permanente pending-lock
  // -----------------------------------------------------------------------
  setTimeout(async () => {
    if (!pending) return;
    if (pending.type !== "heal") return;
    if (pending.targetId !== p.id) return;

    emitLog({
      type: "twist",
      message: `Heal fallback finalize (no animation-complete)`
    });

    const snap = pending;
    pending = null;

    await finalizeHeal(snap);

    io.emit("twist:finish", {
      type: "heal",
      targetId: snap.targetId
    });
  }, 3500); // > animatieduur
}

// ---------------------------- BREAKER -----------------------------------
async function applyBreaker(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  const ok = await consumeTwistFromUser(senderId, "breaker");
  if (!ok) return;

  pending = {
    type: "breaker",
    senderId,
    senderName,
    targetId: p.id
  };

  emitTwistStart("breaker", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} BREAKER gestart → ${p.display_name}`
  });
}

// --------------------------- DIAMOND PISTOL -----------------------------
async function applyDiamondPistol(
  senderId: string,
  senderName: string,
  survivor: any
) {
  if (!survivor) return;

  const arena = getArena();

  if (arena.diamondPistolUsed) {
    emitLog({
      type: "twist",
      message: `${senderName} DiamondPistol → al gebruikt`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "diamondpistol");
  if (!ok) return;

  // ✅ immune wordt genegeerd bij DiamondPistol
  const victims = arena.players.filter(
    p => p.id !== survivor.id
  );

  pending = {
    type: "diamondpistol",
    senderId,
    senderName,
    targetId: survivor.id,
    victimIds: victims.map(v => v.id)
  };

  emitTwistStart("diamondpistol", {
    by: senderName,
    survivorId: survivor.id,
    survivorName: survivor.display_name,
    survivorIndex: getPlayerIndex(survivor.id),
    victimIds: victims.map(v => v.id),
    victimNames: victims.map(v => v.display_name),
    victimIndices: victims.map(v => getPlayerIndex(v.id))
  });

  emitLog({
    type: "twist",
    message: `${senderName} DIAMOND PISTOL animatie gestart`
  });

  arena.diamondPistolUsed = true;
}

// ============================================================================
// ADD TWIST FROM GIFT
// ============================================================================
export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  const def = TWIST_MAP[twist];
  emitLog({ type: "twist", message: `Twist ontvangen: ${def.giftName}` });
}

// ============================================================================
// USE TWIST ENTRY
// ============================================================================
export async function useTwist(
  senderId: string,
  senderName: string,
  twist: TwistType,
  rawTarget?: string
) {
  const arena = getArena();

  if (!["active", "grace"].includes(arena.status)) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist} buiten een ronde`
    });
    return;
  }

  // 🛡️ één actieve twist tegelijk
  if (pending) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist} terwijl een twist nog bezig is`
    });
    return;
  }

  const def = TWIST_MAP[twist];

  let target = null;
  if (def.requiresTarget) {
    target = await findUser(rawTarget || "");
    if (!target) {
      emitLog({
        type: "twist",
        message: `Twist mislukt: target '${rawTarget}' niet gevonden`
      });
      return;
    }
  }

  switch (twist) {
    case "galaxy": return applyGalaxy(senderId, senderName);
    case "moneygun": return applyMoneyGun(senderId, senderName, target);
    case "bomb": return applyBomb(senderId, senderName);
    case "immune": return applyImmuneTwist(senderId, senderName, target);
    case "heal": return applyHeal(senderId, senderName, target);
    case "diamondpistol": return applyDiamondPistol(senderId, senderName, target);
    case "breaker": return applyBreaker(senderId, senderName, target);
  }
}

// ============================================================================
// !use COMMAND PARSER
// ============================================================================
export async function parseUseCommand(
  senderId: string,
  senderName: string,
  msg: string
) {
  const parts = msg.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "!use") return;

  const twist = resolveTwistAlias(parts[1]?.toLowerCase());
  if (!twist) return;

  await useTwist(senderId, senderName, twist, parts[2]?.replace("@", ""));
}

// ============================================================================
// EXPORT
// ============================================================================
export default {
  initTwistEngine,
  useTwist,
  addTwistByGift,
  parseUseCommand
};
