// ============================================================================
// 8-twist-engine.ts — Twist Engine v2.3 (Final, Build-Safe)
// ============================================================================
//
// Verwerkt ALLE twists in BattleBox:
//
//  • galaxy          → ranking omdraaien
//  • moneygun        → target eliminated at endRound
//  • immune          → target immune tegen eliminaties
//  • bomb            → random non-immune speler eliminated
//  • diamondpistol   → iedereen behalve target eliminated
//
// Gebruikt:
//  - twist-definitions
//  - twist-inventory
//  - arena (alive / eliminated)
//  - boosters[] voor immune
//
// Admin-dashboard kan ook twists gebruiken via 9-admin-twist-engine.ts
//
// ============================================================================

import { io, emitLog, emitArena } from "../server";
import {
  getArena,
  safeAddArenaDiamonds,
} from "./5-game-engine";

import {
  giveTwistToUser,
  consumeTwistFromUser,
  listTwistsForUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  resolveTwistAlias,
} from "./twist-definitions";

import pool from "../db";

// ============================================================================
// HELPERS
// ============================================================================

// Zoekt speler in DB op basis van username / @tag
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

// Overlay wrapper
function emitOverlay(event: string, data: any) {
  io.emit(`twist:${event}`, data);
}

// Arena helpers
function setEliminated(id: string) {
  const arena = getArena();
  const p = arena.players.find(p => p.id === id);
  if (!p) return;

  p.status = "eliminated";
  emitArena();
}

function setImmune(id: string) {
  const arena = getArena();
  const p = arena.players.find(p => p.id === id);
  if (!p) return;

  if (!p.boosters.includes("immune")) p.boosters.push("immune");
  emitArena();
}

function removeImmune(id: string) {
  const arena = getArena();
  const p = arena.players.find(p => p.id === id);
  if (!p) return;

  p.boosters = p.boosters.filter(b => b !== "immune");
  emitArena();
}

function hasImmune(id: string): boolean {
  const arena = getArena();
  const p = arena.players.find(p => p.id === id);
  return p?.boosters.includes("immune") ?? false;
}

// ============================================================================
// TWIST IMPLEMENTATIES
// ============================================================================

async function applyGalaxy(senderName: string) {
  const arena = getArena();
  const sorted = [...arena.players].sort((a, b) => a.diamonds - b.diamonds);

  // Replace list
  arena.players.splice(0, arena.players.length, ...sorted);
  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} draaide de ranking om met GALAXY!`,
  });

  emitOverlay("galaxy", { by: senderName });
}

async function applyMoneyGun(senderName: string, target: any) {
  if (hasImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${senderName} gebruikte MoneyGun op ${target.display_name}, maar die is IMMUNE!`,
    });
    return;
  }

  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${senderName} elimineerde ${target.display_name} met MoneyGun!`,
  });

  emitOverlay("moneygun", { by: senderName, target: target.display_name });
}

async function applyImmune(senderName: string, target: any) {
  setImmune(target.id);

  emitLog({
    type: "twist",
    message: `${senderName} gaf IMMUNE aan ${target.display_name}!`,
  });

  emitOverlay("immune", { by: senderName, target: target.display_name });
}

async function applyBomb(senderName: string) {
  const arena = getArena();
  const candidates = arena.players.filter(
    p => p.status === "alive" && !hasImmune(p.id)
  );

  if (candidates.length === 0) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde een Bomb, maar geen targets.`,
    });
    return;
  }

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${senderName} bombardeerde ${target.display_name}!`,
  });

  emitOverlay("bomb", {
    by: senderName,
    target: target.display_name,
    pool: candidates.map(c => c.display_name),
  });
}

async function applyDiamondPistol(senderName: string, survivor: any) {
  const arena = getArena();

  for (const p of arena.players) {
    if (p.id === survivor.id) continue;
    p.status = "eliminated";
  }

  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} gebruikte DIAMOND PISTOL! Alleen ${survivor.display_name} overleeft.`,
  });

  emitOverlay("diamondpistol", {
    by: senderName,
    survivor: survivor.display_name,
  });
}

// ============================================================================
// MAIN USE ENGINE
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
      message: `${senderName} probeerde ${twist}, maar buiten ronde.`,
    });
    return;
  }

  const def = TWIST_MAP[twist];

  // Has twist?
  const ok = await consumeTwistFromUser(senderId, twist);
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${def.giftName}, maar heeft geen twist.`,
    });
    return;
  }

  let target = null;

  if (def.requiresTarget) {
    if (!targetUsername) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${def.giftName} zonder target.`,
      });
      return;
    }

    target = await findUserByUsername(targetUsername);
    if (!target) {
      emitLog({
        type: "twist",
        message: `${senderName} probeerde ${def.giftName} op @${targetUsername}, maar die speler bestaat niet.`,
      });
      return;
    }
  }

  // Execute twist:
  switch (twist) {
    case "galaxy":
      return applyGalaxy(senderName);

    case "moneygun":
      return applyMoneyGun(senderName, target);

    case "immune":
      return applyImmune(senderName, target);

    case "bomb":
      return applyBomb(senderName);

    case "diamondpistol":
      return applyDiamondPistol(senderName, target);

    default:
      emitLog({
        type: "system",
        message: `ONBEKENDE TWIST: ${twist}`,
      });
  }
}

// ============================================================================
// ADD TWIST (via gift-engine)
// ============================================================================

export async function addTwistByGift(
  userId: string,
  twist: TwistType
) {
  await giveTwistToUser(userId, twist);

  const def = TWIST_MAP[twist];

  emitLog({
    type: "twist",
    message: `Ontving twist: ${def.giftName}`,
  });
}

// ============================================================================
// CHAT COMMAND DETECTIE (!use ...)
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
