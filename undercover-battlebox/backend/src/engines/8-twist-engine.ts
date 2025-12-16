// ============================================================================
// 8-twist-engine.ts — Twist Engine v8.3 (HUD EVENT FIXED BUILD)
// ============================================================================
//
// FIXES IN THIS PASS:
// ✔ Bomb START vs HIT strikt gescheiden
// ✔ twist:finish bevat altijd senderName
// ✔ Geen dubbele HUD-notificaties
// ✔ Geen gameplay regressies
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
// ANIMATED TWISTS
// ============================================================================

const ANIMATED_TWISTS: TwistType[] = [
  "bomb",
  "diamondpistol"
];

// ============================================================================
// PENDING STATE
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
// EMIT TWIST START (HUD START ONLY)
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
// SOCKET INIT — FINALIZE ONLY
// ============================================================================

export function initTwistEngine() {
  io.on("connection", (socket) => {
    socket.on("twist:animation-complete", async (payload) => {
      if (!pending) return;
      if (!ANIMATED_TWISTS.includes(pending.type)) return;

      if (payload?.type && payload.type !== pending.type) return;
      if (
        payload?.targetId &&
        pending.targetId &&
        payload.targetId !== pending.targetId
      ) return;

      const snap = pending;
      pending = null;

      if (snap.type === "bomb") await finalizeBomb(snap);
      if (snap.type === "diamondpistol") await finalizeDiamondPistol(snap);

      io.emit("twist:finish", {
        type: snap.type,
        targetId: snap.targetId ?? null,
        byDisplayName: snap.senderName   // ⭐ FIX: sender always known
      });
    });
  });
}

// ============================================================================
// FINALIZERS
// ============================================================================

async function finalizeBomb(p: PendingTwist) {
  if (!p.targetId) return;

  const arena = getArena();
  const pl = arena.players.find(x => x.id === p.targetId);
  if (!pl || pl.eliminated) return;

  pl.eliminated = true;
  pl.positionStatus = "elimination";

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

  pl.eliminated = true;
  pl.positionStatus = "elimination";

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

  if (!pl.boosters.includes("immune")) pl.boosters.push("immune");
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

  if (!survivor.boosters.includes("immune")) survivor.boosters.push("immune");
  survivor.positionStatus = "immune";

  for (const id of p.victimIds ?? []) {
    const v = arena.players.find(x => x.id === id);
    if (!v || v.eliminated) continue;
    v.eliminated = true;
    v.positionStatus = "elimination";
  }

  emitLog({
    type: "twist",
    message: `${p.senderName} DIAMOND PISTOL → ${survivor.display_name} overleeft`
  });

  await emitArena();
}

// ============================================================================
// APPLY FUNCTIONS — ARCHITECTURE FIX (HUD FLOW PATCHED)
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

  // HUD finish (sender always included)
  io.emit("twist:finish", {
    type: "galaxy",
    byDisplayName: senderName
  });
}

// ------------------------------ MONEY GUN (INSTANT) -----------------------
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

    // HUD finish (still show a message if you want; keeps sender correct)
    io.emit("twist:finish", { type: "moneygun", byDisplayName: senderName, targetId: p.id });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "moneygun");
  if (!ok) return;

  emitTwistStart("moneygun", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  emitLog({
    type: "twist",
    message: `${senderName} MoneyGun → ${p.display_name}`
  });

  await finalizeMoneyGun({
    type: "moneygun",
    senderId,
    senderName,
    targetId: p.id
  });

  io.emit("twist:finish", {
    type: "moneygun",
    targetId: p.id,
    byDisplayName: senderName
  });
}

// --------------------------------- BOMB (ANIMATED) -----------------------
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

  // ✅ START = “gooien” (geen target in HUD-message)
  // Belangrijk: twistMessage.js suppresses first bomb → this is the scan/start
  emitTwistStart("bomb", {
    by: senderName
  });

  emitLog({
    type: "twist",
    message: `${senderName} BOMB gestart → ${target.display_name}`
  });

  // fallback finalize → finish event contains senderName now (fixed in schedule below)
  schedulePendingFallback("bomb", target.id, finalizeBomb, 3500, senderName);

  setTimeout(() => {
    bombInProgress = false;
  }, 2000);
}

// -------------------------------- IMMUNE (INSTANT) ------------------------
async function applyImmuneTwist(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  if (p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} IMMUNE geblokkeerd → ${p.display_name} is eliminated`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "immune");
  if (!ok) return;

  emitTwistStart("immune", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  await finalizeImmune({
    type: "immune",
    senderId,
    senderName,
    targetId: p.id
  });

  io.emit("twist:finish", {
    type: "immune",
    targetId: p.id,
    byDisplayName: senderName
  });
}

// -------------------------------- HEAL (INSTANT) --------------------------
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

  emitTwistStart("heal", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  await finalizeHeal({
    type: "heal",
    senderId,
    senderName,
    targetId: p.id
  });

  io.emit("twist:finish", {
    type: "heal",
    targetId: p.id,
    byDisplayName: senderName
  });
}

// ---------------------------- BREAKER (INSTANT) ---------------------------
async function applyBreaker(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find(x => x.id === target.id);
  if (!p) return;

  const ok = await consumeTwistFromUser(senderId, "breaker");
  if (!ok) return;

  emitTwistStart("breaker", {
    by: senderName,
    targetId: p.id,
    targetName: p.display_name,
    targetIndex: getPlayerIndex(p.id)
  });

  await finalizeBreaker({
    type: "breaker",
    senderId,
    senderName,
    targetId: p.id
  });

  io.emit("twist:finish", {
    type: "breaker",
    targetId: p.id,
    byDisplayName: senderName
  });
}

// --------------------------- DIAMOND PISTOL (ANIMATED) --------------------
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

  const victims = arena.players.filter(p => p.id !== survivor.id);

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
    message: `${senderName} DIAMOND PISTOL gestart`
  });

  arena.diamondPistolUsed = true;

  schedulePendingFallback(
    "diamondpistol",
    survivor.id,
    finalizeDiamondPistol,
    4500,
    senderName
  );
}

// ============================================================================
// USE TWIST ENTRY — FIXED GATING
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

  if (pending && ANIMATED_TWISTS.includes(twist)) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist} terwijl animatie nog loopt`
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
// COMMAND PARSER
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
// ADD TWIST FROM GIFT — RESTORED (1-op-1 uit v7.3)
// ============================================================================

export async function addTwistByGift(
  userId: string,
  twist: TwistType
) {
  await giveTwistToUser(userId, twist);

  const def = TWIST_MAP[twist];

  emitLog({
    type: "twist",
    message: `Twist ontvangen: ${def.giftName}`
  });
}

// ============================================================================
// SAFE FALLBACK (UPDATED: include senderName in finish)
// ============================================================================

function schedulePendingFallback(
  type: TwistType,
  targetId: string | null,
  finalizeFn: (snap: any) => Promise<void>,
  delay = 3500,
  senderName?: string
) {
  setTimeout(async () => {
    if (!pending) return;
    if (pending.type !== type) return;
    if (targetId && pending.targetId !== targetId) return;

    emitLog({
      type: "twist",
      message: `${type} fallback finalize (no animation-complete)`
    });

    const snap = pending;
    pending = null;

    await finalizeFn(snap);

    io.emit("twist:finish", {
      type,
      targetId: snap.targetId ?? null,
      byDisplayName: senderName || snap.senderName || "Onbekend"
    });
  }, delay);
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
