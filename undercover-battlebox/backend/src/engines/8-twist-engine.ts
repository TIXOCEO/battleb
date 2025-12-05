// ============================================================================
// 8-twist-engine.ts — Twist Engine v7.3 FINAL
// ============================================================================
//
// ✔ Full support for new overlay payload (target/victims/survivor/index)
// ✔ Added countdown payload for bomb (3 → 2 → 1)
// ✔ All twist events push FULL structured payload
// ✔ Maintains all game logic untouched
// ✔ Compatible with overlay v6/v7 + twistAnim.js v7.2
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

async function applyImmune(id: string): Promise<void> {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return;

  if (!p.boosters.includes("immune")) p.boosters.push("immune");
  p.positionStatus = "immune";

  emitLog({ type: "twist", message: `${p.display_name} kreeg IMMUNE` });
  await emitArena();
}

function markEliminated(id: string): boolean {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return false;

  p.positionStatus = "elimination";
  p.eliminated = true;
  return true;
}

function clearEliminationMark(id: string): boolean {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return false;

  p.positionStatus = "alive";
  p.eliminated = false;
  return true;
}

// ============================================================================
// UNIFORM OVERLAY EMITTER (FULL PAYLOAD)
// ============================================================================
function emitOverlay(name: string, data: any = {}) {
  const MAP: Record<string, string> = {
    moneygun: "moneygun",
    bomb_start: "bomb",
    bomb: "bomb",
    immune: "immune",
    heal: "heal",
    diamondpistol: "diamond",
    breaker_cracked: "breaker",
    breaker_broken: "breaker",
    galaxy: "galaxy"
  };

  const type = MAP[name];
  if (!type) return;

  const title = data.by
    ? `${data.by} gebruikt ${type}`.toUpperCase()
    : type.toUpperCase();

  const payload = {
    type,
    title,
    ...data // << NEW — passes targetName, survivorName, indices etc.
  };

  io.emit("twist:takeover", payload);

  setTimeout(() => io.emit("twist:clear"), 1800);
}

// ============================================================================
// TWISTS
// ============================================================================


// --------------------------------- GALAXY -----------------------------------
async function applyGalaxy(senderId: string, senderName: string): Promise<void> {
  const ok = await consumeTwistFromUser(senderId, "galaxy");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Galaxy zonder twist` });
    return;
  }

  const reversed = toggleGalaxyMode();

  emitOverlay("galaxy", { by: senderName, reversed });

  emitLog({
    type: "twist",
    message: `${senderName} GALAXY → ranking ${reversed ? "omgekeerd" : "normaal"}`
  });

  await emitArena();
}


// ------------------------------- MONEYGUN -----------------------------------
async function applyMoneyGun(senderId, senderName, target) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${senderName} MoneyGun → ${target.display_name} is IMMUNE`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "moneygun");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde MoneyGun zonder twist` });
    return;
  }

  markEliminated(target.id);

  emitOverlay("moneygun", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id)
  });

  emitLog({ type: "twist", message: `${senderName} MoneyGun → ${target.display_name} ELIM` });

  await emitArena();
}


// --------------------------------- BOMB -------------------------------------
let bombInProgress = false;

async function applyBomb(senderId, senderName) {
  const arena = getArena();

  if (bombInProgress) {
    emitLog({ type: "twist", message: `${senderName} Bomb → bezig…` });
    return;
  }

  const candidates = arena.players.filter(
    p => !p.boosters.includes("immune") && !p.eliminated
  );

  if (!candidates.length) {
    emitLog({ type: "twist", message: `${senderName} Bomb → geen targets` });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "bomb");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Bomb zonder twist` });
    return;
  }

  bombInProgress = true;

  emitOverlay("bomb_start", { by: senderName });

  // NEW: COUNTDOWN → overlay
  for (let i = 3; i >= 1; i--) {
    io.emit("twist:countdown", {
      type: "countdown",
      step: i,
      by: senderName
    });

    await sleep(1000);
  }

  const updated = getArena();
  const valid = updated.players.filter(
    p => !p.boosters.includes("immune") && !p.eliminated
  );

  if (!valid.length) {
    bombInProgress = false;
    return;
  }

  const chosen = valid[Math.floor(Math.random() * valid.length)];
  markEliminated(chosen.id);

  emitOverlay("bomb", {
    by: senderName,
    targetId: chosen.id,
    targetName: chosen.display_name,
    targetIndex: getPlayerIndex(chosen.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} BOMB → ${chosen.display_name} geraakt`
  });

  await emitArena();
  bombInProgress = false;
}


// ------------------------------- IMMUNE -------------------------------------
async function applyImmuneTwist(senderId, senderName, target) {
  if (!target) return;

  const ok = await consumeTwistFromUser(senderId, "immune");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Immune zonder twist` });
    return;
  }

  await applyImmune(target.id);

  emitOverlay("immune", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id)
  });

  await emitArena();
}


// --------------------------------- HEAL -------------------------------------
async function applyHeal(senderId, senderName, target) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  if (!p.eliminated) {
    emitLog({ type: "twist", message: `${senderName} Heal → ${target.display_name} is niet gemarkeerd` });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "heal");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Heal zonder twist` });
    return;
  }

  p.boosters = p.boosters.filter(b => !["mg", "bomb"].includes(b));
  clearEliminationMark(target.id);

  emitOverlay("heal", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id)
  });

  emitArena();
}


// ------------------------------- BREAKER ------------------------------------
async function applyBreaker(senderId, senderName, target) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  const ok = await consumeTwistFromUser(senderId, "breaker");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Breaker zonder twist` });
    return;
  }

  p.breakerHits = (p.breakerHits ?? 0) + 1;

  const idx = getPlayerIndex(p.id);

  if (p.breakerHits === 1) {
    emitOverlay("breaker_cracked", {
      by: senderName,
      targetId: p.id,
      targetName: p.display_name,
      targetIndex: idx
    });
  } else {
    p.boosters = p.boosters.filter(b => b !== "immune");
    p.positionStatus = "alive";

    emitOverlay("breaker_broken", {
      by: senderName,
      targetId: p.id,
      targetName: p.display_name,
      targetIndex: idx
    });
  }

  emitArena();
}


// --------------------------- DIAMOND PISTOL ---------------------------------
async function applyDiamondPistol(senderId, senderName, survivor) {
  if (!survivor) return;

  const arena = getArena();

  if (arena.diamondPistolUsed) {
    emitLog({ type: "twist", message: `${senderName} DiamondPistol → al gebruikt` });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "diamondpistol");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde DiamondPistol zonder twist` });
    return;
  }

  const victims = arena.players.filter(
    p => p.id !== survivor.id && !p.boosters.includes("immune")
  );

  victims.forEach(v => markEliminated(v.id));

  const surv = arena.players.find(p => p.id === survivor.id);
  if (surv && !surv.boosters.includes("immune")) surv.boosters.push("immune");
  if (surv) surv.positionStatus = "immune";

  arena.diamondPistolUsed = true;

  emitOverlay("diamondpistol", {
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
    message: `${senderName} DIAMOND PISTOL → ${survivor.display_name} overleeft`
  });

  await emitArena();
}


// ============================================================================
// USE TWIST
// ============================================================================
export async function useTwist(senderId, senderName, twist, rawTarget) {
  const arena = getArena();

  if (!["active", "grace"].includes(arena.status)) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist} buiten een ronde`
    });
    return;
  }

  let target = null;

  if (TWIST_MAP[twist].requiresTarget) {
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
// ADD TWIST FROM GIFT
// ============================================================================
export async function addTwistByGift(userId, twist) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Twist ontvangen: ${TWIST_MAP[twist].giftName}`
  });
}


// ============================================================================
// !use COMMAND PARSER
// ============================================================================
export async function parseUseCommand(senderId, senderName, msg) {
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
  addTwistByGift,
  parseUseCommand
};
