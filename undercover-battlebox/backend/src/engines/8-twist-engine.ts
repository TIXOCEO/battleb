// ============================================================================
// 8-twist-engine.ts — Twist Engine v7.0 (Target-Based Animations + Countdown)
// ============================================================================
//
// ✔ Volledig compatibel met Overlay v6/v7
// ✔ Nieuw: twist:countdown event voor bomb (3 → 2 → 1)
// ✔ Nieuw: volledige target-informatie (id, name, index)
// ✔ Nieuw: victims + survivor indices voor DiamondPistol
// ✔ Nieuw: uniforme emitOverlay() → payload door naar overlay
// ✔ Geen game-logic gewijzigd, alleen animatie-informatie toegevoegd
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
  return new Promise((res) => setTimeout(res, ms));
}

async function findUser(raw: string): Promise<any | null> {
  const clean = raw.replace("@", "").trim().toLowerCase();

  const q = await pool.query(
    `
      SELECT tiktok_id, username, display_name
      FROM users
      WHERE LOWER(username)=LOWER($1)
      LIMIT 1
    `,
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
  return getArena().players.find((p) => p.id === id) || null;
}

function getPlayerIndex(id: string): number {
  return getArena().players.findIndex((p) => p.id === id);
}

function isImmune(id: string): boolean {
  const p = getArenaPlayer(id);
  return p?.boosters.includes("immune") || p?.positionStatus === "immune";
}

async function applyImmune(id: string): Promise<void> {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return;

  if (!p.boosters.includes("immune")) p.boosters.push("immune");
  p.positionStatus = "immune";

  emitLog({
    type: "twist",
    message: `${p.display_name} kreeg IMMUNE`
  });

  await emitArena();
}

function markEliminated(id: string): boolean {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return false;

  p.positionStatus = "elimination";
  p.eliminated = true;
  return true;
}

function clearEliminationMark(id: string): boolean {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return false;

  p.positionStatus = "alive";
  p.eliminated = false;
  return true;
}

// ============================================================================
// UNIFORM OVERLAY EMITTER (PATCHED)
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
    ...data
  };

  io.emit("twist:takeover", payload);

  setTimeout(() => io.emit("twist:clear"), 1800);
}

// ============================================================================
// TWISTS
// ============================================================================


// GALAXY
async function applyGalaxy(senderId: string, senderName: string): Promise<void> {
  const ok = await consumeTwistFromUser(senderId, "galaxy");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Galaxy, maar heeft geen twist`
    });
    return;
  }

  const reversedNow = toggleGalaxyMode();

  emitOverlay("galaxy", {
    by: senderName,
    reverse: reversedNow
  });

  emitLog({
    type: "twist",
    message: `${senderName} gebruikte GALAXY → ranking nu ${reversedNow ? "omgekeerd" : "normaal"}`
  });

  await emitArena();
}

// ============================================================================
// MONEYGUN — (targetId + targetIndex + targetName)
// ============================================================================
async function applyMoneyGun(senderId: string, senderName: string, target: any): Promise<void> {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
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

  emitLog({
    type: "twist",
    message: `${senderName} MoneyGun → ${target.display_name} GEMARKEERD`
  });

  await emitArena();
}

// ============================================================================
// BOMB — met 3-2-1 COUNTDOWN + targetIndex
// ============================================================================

let bombInProgress = false;

async function applyBomb(senderId: string, senderName: string): Promise<void> {
  const arena = getArena();

  if (bombInProgress) {
    emitLog({ type: "twist", message: `${senderName} Bomb → wacht…` });
    return;
  }

  const list = arena.players.filter(
    (p) => !p.boosters.includes("immune") && !p.eliminated
  );

  if (!list.length) {
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

  // COUNTDOWN → overlay
  for (let i = 3; i >= 1; i--) {
    io.emit("twist:countdown", {
      type: "bomb",
      step: i,
      by: senderName
    });
    await sleep(1000);
  }

  const updated = getArena();
  const valid = updated.players.filter(
    (p) => !p.boosters.includes("immune") && !p.eliminated
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

// ============================================================================
// IMMUNE (targetIndex toegevoegd)
// ============================================================================
async function applyImmuneTwist(senderId: string, senderName: string, target: any): Promise<void> {
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

// ============================================================================
// HEAL (target info toegevoegd)
// ============================================================================
async function applyHeal(senderId: string, senderName: string, target: any): Promise<void> {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  if (!p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} HEAL → ${target.display_name} heeft geen MG/Bomb markering`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "heal");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Heal zonder twist` });
    return;
  }

  p.boosters = p.boosters.filter((b) => !["mg", "bomb"].includes(b));
  clearEliminationMark(target.id);

  emitOverlay("heal", {
    by: senderName,
    targetId: target.id,
    targetName: target.display_name,
    targetIndex: getPlayerIndex(target.id)
  });

  await emitArena();
}

// ============================================================================
// BREAKER (CRACKED/BROKEN) — targetIndex toegevoegd
// ============================================================================
async function applyBreaker(senderId: string, senderName: string, target: any): Promise<void> {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  const ok = await consumeTwistFromUser(senderId, "breaker");
  if (!ok) {
    emitLog({ type: "twist", message: `${senderName} probeerde Breaker zonder twist` });
    return;
  }

  p.breakerHits = (p.breakerHits ?? 0) + 1;

  const index = getPlayerIndex(p.id);

  if (p.breakerHits === 1) {
    emitOverlay("breaker_cracked", {
      by: senderName,
      targetId: p.id,
      targetName: p.display_name,
      targetIndex: index
    });
  } else {
    p.boosters = p.boosters.filter((b) => b !== "immune");
    p.positionStatus = "alive";

    emitOverlay("breaker_broken", {
      by: senderName,
      targetId: p.id,
      targetName: p.display_name,
      targetIndex: index
    });
  }

  await emitArena();
}

// ============================================================================
// DIAMOND PISTOL — volledige mapping toegevoegd (survivor + victims)
// ============================================================================
async function applyDiamondPistol(senderId: string, senderName: string, survivor: any): Promise<void> {
  if (!survivor) return;

  const arena = getArena();

  if (arena.diamondPistolUsed) {
    emitLog({
      type: "twist",
      message: `${senderName} → DiamondPistol al gebruikt`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "diamondpistol");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde DiamondPistol zonder twist`
    });
    return;
  }

  const victims = arena.players.filter(
    (p) => p.id !== survivor.id && !p.boosters.includes("immune")
  );

  victims.forEach((v) => markEliminated(v.id));

  const surv = arena.players.find((p) => p.id === survivor.id);
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
export async function useTwist(
  senderId: string,
  senderName: string,
  twist: TwistType,
  rawTarget?: string
): Promise<void> {
  const arena = getArena();

  if (arena.status !== "active" && arena.status !== "grace") {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist} buiten een ronde`
    });
    return;
  }

  let target: any = null;

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
// ADD TWIST BY GIFT
// ============================================================================
export async function addTwistByGift(userId: string, twist: TwistType): Promise<void> {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Twist ontvangen: ${TWIST_MAP[twist].giftName}`
  });
}

// ============================================================================
// PARSER (!use <twist> <target>)
// ============================================================================
export async function parseUseCommand(senderId: string, senderName: string, msg: string): Promise<void> {
  const parts = msg.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "!use") return;

  const alias = parts[1]?.toLowerCase();
  const twist = resolveTwistAlias(alias);
  if (!twist) return;

  const target = parts[2] ? parts[2].replace("@", "") : undefined;

  await useTwist(senderId, senderName, twist, target);
}

// ============================================================================
// EXPORT
// ============================================================================
export default {
  useTwist,
  addTwistByGift,
  parseUseCommand
};
