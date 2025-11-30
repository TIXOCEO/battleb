// ============================================================================
// 8-twist-engine.ts — Twist Engine v14.4 (MoneyGun/Bomb Fase-1 Upgrade)
// ============================================================================
//
// ✔ Compatibel met Arena Engine v15+
// ✔ MoneyGun markeert eliminate-status (end-round)
// ✔ Bomb markeert eliminate-status (end-round)
// ✔ Heal verwijdert alleen MG/Bomb eliminaties
// ✔ Immune blijft booster die MG/Bomb blokkeert
// ✔ DiamondPistol ongewijzigd (full power, geen ronde-limit toegevoegd)
// ✔ parseUseCommand FIXED (belangrijk!)
// ✔ Overige logica ongewijzigd gelaten
//
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  eliminate // admin/manual only
} from "./5-game-engine";

import {
  giveTwistToUser,
  consumeTwistFromUser,
  listTwistsForUser
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

async function findUser(raw: string) {
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

function isImmune(id: string) {
  const p = getArenaPlayer(id);
  return p?.boosters.includes("immune") || p?.positionStatus === "immune";
}

async function applyImmune(id: string) {
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

function markEliminated(id: string) {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return false;

  p.positionStatus = "elimination";
  p.eliminated = true;
  return true;
}

function clearEliminationMark(id: string) {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return false;

  p.positionStatus = "alive";
  p.eliminated = false;
  return true;
}

function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

// ============================================================================
// TWISTS
// ============================================================================

// GALAXY (ongewijzigd)
async function applyGalaxy(sender: string) {
  const arena = getArena();

  const sorted = [...arena.players].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );

  arena.players.splice(0, arena.players.length, ...sorted);

  emitOverlay("galaxy", { by: sender });

  emitLog({
    type: "twist",
    message: `${sender} gebruikte GALAXY!`
  });

  await emitArena();
}

// ============================================================================
// MONEYGUN — FASE 1
// Markeert target voor eliminatie aan end-round
// ============================================================================

async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} MoneyGun → ${target.display_name} is IMMUNE!`
    });
    return;
  }

  const success = markEliminated(target.id);
  if (!success) return;

  emitOverlay("moneygun", {
    by: sender,
    target: target.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} MoneyGun → ${target.display_name} gemarkeerd voor eliminatie`
  });

  await emitArena();
}

// ============================================================================
// BOMB — FASE 1 UPGRADE
// Random target → markeren voor end-round eliminatie
// Immune wordt overgeslagen
// ============================================================================

async function applyBomb(sender: string) {
  const arena = getArena();

  const poolTargets = arena.players.filter(
    (p) => !p.boosters.includes("immune")
  );

  if (!poolTargets.length) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → geen geldige targets`
    });
    return;
  }

  const chosen = poolTargets[Math.floor(Math.random() * poolTargets.length)];

  markEliminated(chosen.id);

  emitOverlay("bomb", {
    by: sender,
    target: chosen.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} BOMB → ${chosen.display_name} gemarkeerd voor eliminatie`
  });

  await emitArena();
}

// ============================================================================
// IMMUNE (ongewijzigd)
// ============================================================================

async function applyImmuneTwist(sender: string, target: any) {
  if (!target) return;

  await applyImmune(target.id);

  emitOverlay("immune", {
    by: sender,
    target: target.display_name
  });

  await emitArena();
}

// ============================================================================
// HEAL — FASE 1 LOGICA
// Verwijdert elimination-status van MG/Bomb
// Werkt NIET tegen DiamondPistol
// ============================================================================

async function applyHeal(sender: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  if (!p.eliminated) {
    emitLog({
      type: "twist",
      message: `${sender} HEAL → ${target.display_name} heeft geen MG/Bomb eliminatie-status`
    });
    return;
  }

  clearEliminationMark(target.id);

  emitOverlay("heal", {
    by: sender,
    target: target.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} HEAL → ${target.display_name} is hersteld`
  });

  await emitArena();
}

// ============================================================================
// DIAMOND PISTOL (ongewijzigd, geen ronde-limit toegevoegd)
// ============================================================================

async function applyDiamondPistol(sender: string, survivor: any) {
  if (!survivor) return;

  const arena = getArena();

  const victims = arena.players.filter(
    (p) =>
      p.id !== survivor.id &&
      !p.boosters.includes("immune")
  );

  for (const v of victims) {
    await eliminate(v.username);
  }

  emitOverlay("diamondpistol", {
    by: sender,
    survivor: survivor.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} DIAMOND PISTOL → ${survivor.display_name} overleeft!`
  });

  await emitArena();
}

// ============================================================================
// MAIN — USE TWIST (EXPORTED)
// ============================================================================

export async function useTwist(
  senderId: string,
  senderName: string,
  twist: TwistType,
  rawTarget?: string
) {
  const arena = getArena();

  if (arena.status !== "active" && arena.status !== "grace") {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist}, maar buiten ronde`
    });
    return;
  }

  // Twist verbruiken
  const ok = await consumeTwistFromUser(senderId, twist);
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${
        TWIST_MAP[twist].giftName
      }, maar heeft geen twist`
    });
    return;
  }

  // TARGET ophalen indien nodig
  let target = null;
  if (TWIST_MAP[twist].requiresTarget) {
    target = await findUser(rawTarget || "");
    if (!target) {
      emitLog({
        type: "twist",
        message: `Twist mislukt: target '${rawTarget}' bestaat niet`
      });
      return;
    }
  }

  // ROUTING
  switch (twist) {
    case "galaxy":
      return applyGalaxy(senderName);

    case "moneygun":
      return applyMoneyGun(senderName, target);

    case "bomb":
      return applyBomb(senderName);

    case "immune":
      return applyImmuneTwist(senderName, target);

    case "heal":
      return applyHeal(senderName, target);

    case "diamondpistol":
      return applyDiamondPistol(senderName, target);
  }
}

// ============================================================================
// ADD TWIST (EXPORTED)
// ============================================================================

export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Twist ontvangen: ${TWIST_MAP[twist].giftName}`
  });
}

// ============================================================================
// PARSER (!use ...) (EXPORTED)
// ============================================================================

export async function parseUseCommand(
  senderId: string,
  senderName: string,
  msg: string
) {
  const parts = msg.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "!use") return;

  const alias = parts[1]?.toLowerCase();
  const twist = resolveTwistAlias(alias);
  if (!twist) return;

  const target = parts[2] ? parts[2].replace("@", "") : undefined;

  await useTwist(senderId, senderName, twist, target);
}

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default {
  useTwist,
  addTwistByGift,
  parseUseCommand
};
