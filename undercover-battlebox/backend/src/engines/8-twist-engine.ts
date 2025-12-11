// ============================================================================
// 8-twist-engine.ts — Twist Engine v8.0
// ANIMATION-SAFE VERSION — waits for frontend animation to finish
// ============================================================================
//
// ✔ Geen directe eliminaties meer — eerst animatie → daarna backend elimineert
// ✔ Uniform event model: twist:start + twist:finish
// ✔ Volledige payload naar overlay: type, by, target, index, victims, etc
// ✔ Frontend stuurt: twist:animation-complete { type, targetId }
// ✔ Backend verwerkt dan pas eliminatie / immunity / breaker logic
//
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  toggleGalaxyMode
} from "./5-game-engine";

import {
  giveTwistToUser,
  consumeTwistFromUser
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  resolveTwistAlias,
  TwistDefinition
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

function getArenaPlayer(id: string) {
  return getArena().players.find(p => p.id === id) || null;
}

function getPlayerIndex(id: string): number {
  return getArena().players.findIndex(p => p.id === id);
}

function isImmune(id: string): boolean {
  const p = getArenaPlayer(id);
  return p?.boosters.includes("immune") || p?.positionStatus === "immune";
}

// ============================================================================
// NEW CORE OVERLAY EVENT MODEL
// ============================================================================
//
// twist:start  → frontend doet pop-up + animatie
// frontend stuurt: twist:animation-complete
// backend verwerkt eliminatie / immunity / breaker logic
// kemudian:
// twist:finish → overlay cleart alles
//
// ============================================================================

function emitTwistStart(type: string, data: any = {}) {
  io.emit("twist:start", { type, ...data });
}

function emitTwistFinish(type: string, data: any = {}) {
  io.emit("twist:finish", { type, ...data });
}

// ============================================================================
// ANIMATION GATE — backend wacht totdat frontend klaar is
// ============================================================================
//
// Zodra een twist start, slaan we tijdelijk de "pending action" op.
// Frontend stuurt daarna:
//
// socket.emit("twist:animation-complete", { type, targetId })
//
// Backend verwerkt dán pas de daadwerkelijke eliminatie / immunity / etc.
// ============================================================================

interface PendingTwist {
  type: TwistType;
  senderId: string;
  senderName: string;
  targetId?: string | null;
  victimIds?: string[] | null;
}

let pending: PendingTwist | null = null;

io.on("connection", (socket) => {
  socket.on("twist:animation-complete", async (payload) => {
    if (!pending) return;

    const p = pending;
    pending = null;

    switch (p.type) {
      case "bomb":
        await finalizeBomb(p);
        break;
      case "moneygun":
        await finalizeMoneyGun(p);
        break;
      case "immune":
        await finalizeImmune(p);
        break;
      case "heal":
        await finalizeHeal(p);
        break;
      case "diamondpistol":
        await finalizeDiamondPistol(p);
        break;
      case "breaker":
        await finalizeBreaker(p);
        break;
    }

    emitTwistFinish(p.type, { targetId: p.targetId });
  });
});

// ============================================================================
// FINALIZERS — worden ALLEEN uitgevoerd nadat animatie is afgelopen
// ============================================================================

async function finalizeBomb(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl) return;

  pl.positionStatus = "elimination";
  pl.eliminated = true;

  emitLog({ type: "twist", message: `${p.senderName} BOMB → ${pl.display_name} geëlimineerd` });
  await emitArena();
}

async function finalizeMoneyGun(p: PendingTwist) {
  if (!p.targetId) return;
  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl) return;

  pl.positionStatus = "elimination";
  pl.eliminated = true;

  emitLog({ type: "twist", message: `${p.senderName} MoneyGun → ${pl.display_name} geëlimineerd` });
  await emitArena();
}

async function finalizeImmune(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl) return;

  if (!pl.boosters.includes("immune")) pl.boosters.push("immune");
  pl.positionStatus = "immune";

  emitLog({ type: "twist", message: `${p.senderName} IMMUNE → ${pl.display_name}` });
  await emitArena();
}

async function finalizeHeal(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl) return;

  pl.eliminated = false;
  pl.positionStatus = "alive";
  pl.boosters = pl.boosters.filter(b => !["mg", "bomb"].includes(b));

  emitLog({ type: "twist", message: `${p.senderName} HEAL → ${pl.display_name}` });
  await emitArena();
}

async function finalizeDiamondPistol(p: PendingTwist) {
  const arena = getArena();
  if (!p.targetId) return;

  const survivor = arena.players.find(x => x.id === p.targetId);
  if (!survivor) return;

  if (!survivor.boosters.includes("immune")) survivor.boosters.push("immune");
  survivor.positionStatus = "immune";

  for (const vid of p.victimIds ?? []) {
    const v = arena.players.find(x => x.id === vid);
    if (!v) continue;
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
  if (!pl) return;

  pl.breakerHits = (pl.breakerHits ?? 0) + 1;

  if (pl.breakerHits >= 2) {
    pl.boosters = pl.boosters.filter(b => b !== "immune");
    pl.positionStatus = "alive";
  }

  emitLog({ type: "twist", message: `${p.senderName} BREAKER → ${pl.display_name}` });
  await emitArena();
}

// ============================================================================
// TWIST LOGIC — produces START event then defers finalization
// ============================================================================

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

// ============================================================================
// START EVENT EMITTER (frontend animatie start)
// ============================================================================

function emitTwistStart(type: TwistType, extra: any = {}) {
  const title = extra.by
    ? `${extra.by} gebruikt ${type}`.toUpperCase()
    : type.toUpperCase();

  io.emit("twist:takeover", {
    type,
    title,
    ...extra
  });
}

// ============================================================================
// TWIST APPLY — alles stuurt alleen START event + zet pending action
// Finalisatie gebeurt pas nadat frontend "twist:animation-complete" stuurt
// ============================================================================

// -------------------------------- GALAXY ------------------------------------

async function applyGalaxy(senderId: string, senderName: string): Promise<void> {
  const ok = await consumeTwistFromUser(senderId, "galaxy");
  if (!ok) return;

  const reversed = toggleGalaxyMode();

  emitTwistStart("galaxy", {
    by: senderName,
    reversed
  });

  emitLog({
    type: "twist",
    message: `${senderName} GALAXY → ranking ${reversed ? "omgekeerd" : "normaal"}`
  });

  await emitArena();
}

// ------------------------------ MONEY GUN -----------------------------------

async function applyMoneyGun(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

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
    targetIndex: getPlayerIndex(p.id),
  });

  emitLog({
    type: "twist",
    message: `${senderName} MoneyGun gestart op ${p.display_name}`
  });
}

// --------------------------------- BOMB -------------------------------------

let bombInProgress = false;

async function applyBomb(senderId: string, senderName: string) {
  if (bombInProgress) {
    emitLog({
      type: "twist",
      message: `${senderName} Bomb → bezig…`
    });
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

  // Kies target
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
    targetIndex: getPlayerIndex(target.id),
  });

  emitLog({
    type: "twist",
    message: `${senderName} BOMB animatie gestart → target ${target.display_name}`
  });

  // Finalisatie gebeurt pas bij "twist:animation-complete"
  bombInProgress = false;
}

// -------------------------------- IMMUNE ------------------------------------

async function applyImmuneTwist(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const ok = await consumeTwistFromUser(senderId, "immune");
  if (!ok) return;

  pending = {
    type: "immune",
    senderId,
    senderName,
    targetId: target.id
  };

  emitTwistStart("immune", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id),
  });

  emitLog({
    type: "twist",
    message: `${senderName} IMMUNE gestart → ${target.display_name}`
  });
}

// -------------------------------- HEAL --------------------------------------

async function applyHeal(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  if (!p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} Heal → ${p.display_name} is niet eliminated`
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
    targetIndex: getPlayerIndex(p.id),
  });

  emitLog({
    type: "twist",
    message: `${senderName} HEAL gestart → ${p.display_name}`
  });
}

// ---------------------------- BREAKER ---------------------------------------

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
    targetIndex: getPlayerIndex(p.id),
  });

  emitLog({
    type: "twist",
    message: `${senderName} BREAKER gestart → ${p.display_name}`
  });
}

// --------------------------- DIAMOND PISTOL ---------------------------------

async function applyDiamondPistol(senderId: string, senderName: string, survivor: any) {
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

  const victims = arena.players.filter(
    p => p.id !== survivor.id && !p.boosters.includes("immune")
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
// USE TWIST
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
  useTwist,
  parseUseCommand
};
