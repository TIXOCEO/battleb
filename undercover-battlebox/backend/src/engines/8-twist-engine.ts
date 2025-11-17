// ============================================================================
// 8-twist-engine.ts — Twist Engine v1.0
// ============================================================================
//
// Verwerkt ALLE twists:
//  - Galaxy (reverse ranking)
//  - MoneyGun (target → elimination status)
//  - Immunity (target → immune)
//  - Heal (target → remove elimination)
//  - Bomb (random non-immune active → elimination)
//  - Diamond Pistol (target survives, iedereen anders eliminated)
//
// Gebruik:
//   - Via chat (!use)
//   - Via gift-engine (auto acquisition)
//   - Via admin dashboard
//
// Afhankelijk van:
//   - twist-definitions
//   - twist-inventory
//   - game-engine
//   - user-engine
//   - server socket (emitLog / emitArena)
//
// ============================================================================

import { io, emitLog, emitArena } from "../server";
import {
  getArena,
  arenaLeave,
  safeAddArenaDiamonds,
} from "./5-game-engine";

import {
  addTwistToUser,
  userHasTwist,
  consumeTwistFromUser,
  getUserTwistInventory,
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  findTwistByAlias,
} from "./twist-definitions";

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";

// ============================================================================
// Helper functies
// ============================================================================

async function findUserByUsername(raw: string) {
  const clean = raw.replace("@", "").toLowerCase().trim();

  const { rows } = await pool.query(
    `
      SELECT tiktok_id, username, display_name
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
    `,
    [clean]
  );

  if (!rows[0]) return null;

  return {
    id: rows[0].tiktok_id.toString(),
    username: rows[0].username.replace("@", ""),
    display_name: rows[0].display_name,
  };
}

// Emit overlay event
function emitOverlay(event: string, data: any) {
  io.emit(`twist:${event}`, data);
}

// Set elimination state inside arena.positionMap
async function markEliminatedInArena(tiktokId: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === tiktokId);
  if (!p) return;

  // We gebruiken hier 'status: elimination'. Arena-engine herkent dit.
  p.status = "eliminated";

  emitArena();
}

// Set immune state
async function markImmuneInArena(tiktokId: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === tiktokId);
  if (!p) return;

  // Niet native in positionMap, maar we gebruiken boosters of markers
  p.status = "alive"; // blijft alive
  // We gebruiken boosters als signaal
  if (!p.boosters.includes("immune")) p.boosters.push("immune");

  emitArena();
}

async function removeImmuneInArena(tiktokId: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === tiktokId);
  if (!p) return;

  p.boosters = p.boosters.filter((b) => b !== "immune");
  emitArena();
}

// Check immuniteit
function isImmuneInArena(tiktokId: string): boolean {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === tiktokId);
  if (!p) return false;
  return p.boosters.includes("immune");
}

// ============================================================================
// GALAXY (Ranking Reverse)
// ============================================================================

async function applyGalaxy(senderId: string, senderName: string) {
  const arena = getArena();
  const list = [...arena.players];

  // Reverse sort op diamonds
  list.sort((a, b) => a.diamonds - b.diamonds);

  // Push reversed order terug in arena
  arena.players.splice(0, arena.players.length, ...list);

  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} draaide de ranking om met GALAXY!`,
  });

  // Overlay event
  emitOverlay("galaxy", {
    by: senderName,
  });
}

// ============================================================================
// MoneyGun — target krijgt elimination status (end-round)
// ============================================================================

async function applyMoneyGun(
  senderId: string,
  senderName: string,
  target: any
) {
  const targetId = target.id;

  // immune blokkeert moneygun — zoals jij bepaalde
  if (isImmuneInArena(targetId)) {
    emitLog({
      type: "twist",
      message: `${senderName} vuurde MoneyGun af op ${target.display_name}, maar die is IMMUNE!`,
    });
    return;
  }

  await markEliminatedInArena(targetId);

  emitLog({
    type: "twist",
    message: `${senderName} elimineerde ${target.display_name} met MoneyGun!`,
  });

  emitOverlay("moneygun", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// IMMUNE — target krijgt immuniteit (beschermt tegen eliminatie)
// ============================================================================

async function applyImmune(senderName: string, target: any) {
  await markImmuneInArena(target.id);

  emitLog({
    type: "twist",
    message: `${target.display_name} kreeg IMMUNE van ${senderName}!`,
  });

  emitOverlay("immune", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// HEAL — verwijdert elimination status
// ============================================================================

async function applyHeal(senderName: string, target: any) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  if (p.status !== "eliminated") {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${target.display_name} te healen, maar die is niet eliminated.`,
    });
    return;
  }

  // Verwijder elimination status
  p.status = "alive";
  removeImmuneInArena(target.id);

  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} healde ${target.display_name} en bracht hem terug in het spel!`,
  });

  emitOverlay("heal", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// DIAMOND PISTOL — iedereen behalve target krijgt elimination
// ============================================================================

async function applyDiamondPistol(
  senderName: string,
  target: any
) {
  const arena = getArena();

  for (const p of arena.players) {
    if (p.id === target.id) continue; // target blijft leven
    p.status = "eliminated";
  }

  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} gebruikte DIAMOND PISTOL! Iedereen behalve ${target.display_name} is geëlimineerd!`,
  });

  emitOverlay("diamondpistol", {
    by: senderName,
    survivor: target.display_name,
  });
}

// ============================================================================
// BOMB — random non-immune actieve speler → elimination
// ============================================================================

async function applyBomb(senderName: string) {
  const arena = getArena();

  const candidates = arena.players.filter(
    (p) => p.status === "alive" && !isImmuneInArena(p.id)
  );

  if (candidates.length === 0) {
    emitLog({
      type: "twist",
      message: `${senderName} gebruikte een Bomb, maar er zijn geen geschikte targets.`,
    });
    return;
  }

  const target = candidates[Math.floor(Math.random() * candidates.length)];

  target.status = "eliminated";
  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} bombardeerde ${target.display_name}!`,
  });

  emitOverlay("bomb", {
    by: senderName,
    target: target.display_name,
    allCandidates: candidates.map((c) => c.display_name),
  });
}

// ============================================================================
// MAIN PROCESSOR — USE TWIST (chat + admin)
// ============================================================================

export async function useTwist(
  senderId: string,
  senderName: string,
  twist: TwistType,
  targetUsername?: string
) {
  const arena = getArena();

  if (arena.status !== "active" && arena.status !== "grace") {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde een twist te gebruiken buiten een ronde.`,
    });
    return;
  }

  // Heeft user twist?
  if (!(await userHasTwist(senderId, twist))) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist}, maar heeft geen twist tegoed.`,
    });
    return;
  }

  // Verbruik twist
  await consumeTwistFromUser(senderId, twist);

  // Target zoeken indien nodig
  let target = null;
  if (TWIST_MAP[twist].requiresTarget) {
    if (!targetUsername) {
      emitLog({
        type: "twist",
        message: `${senderName} probeerde ${twist}, maar gaf geen target.`,
      });
      return;
    }

    target = await findUserByUsername(targetUsername);
    if (!target) {
      emitLog({
        type: "twist",
        message: `${senderName} probeerde ${twist} op @${targetUsername}, maar die speler bestaat niet.`,
      });
      return;
    }
  }

  // Twist uitvoeren
  switch (twist) {
    case "galaxy":
      return applyGalaxy(senderId, senderName);

    case "moneygun":
      return applyMoneyGun(senderId, senderName, target);

    case "immune":
      return applyImmune(senderName, target);

    case "diamond_pistol":
      return applyDiamondPistol(senderName, target);

    case "bomb":
      return applyBomb(senderName);

    case "heal":
      return applyHeal(senderName, target);
  }
}

// ============================================================================
// ADD TWIST (gift-engine & admin)
// ============================================================================

export async function addTwistByGift(
  senderId: string,
  twist: TwistType,
  amount: number
) {
  await addTwistToUser(senderId, twist, amount);

  const { display_name } = await getOrUpdateUser(senderId);

  emitLog({
    type: "twist",
    message: `${display_name} kocht 1x ${TWIST_MAP[twist].giftName}.`,
  });
}

// ============================================================================
// Detectie chat command (!use ...)
// ============================================================================

export async function parseUseCommand(
  senderId: string,
  senderName: string,
  message: string
) {
  const parts = message.trim().split(/\s+/);
  if (parts.length < 2) return;

  if (parts[0].toLowerCase() !== "!use") return;

  const twistAlias = parts[1].toLowerCase();
  const twist = findTwistByAlias(twistAlias);
  if (!twist) return;

  // Optional target
  const targetUsername = parts[2]
    ? parts[2].replace("@", "")
    : undefined;

  await useTwist(senderId, senderName, twist, targetUsername);
}
