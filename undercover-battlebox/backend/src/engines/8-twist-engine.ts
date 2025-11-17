// ============================================================================
// 8-twist-engine.ts — Twist Engine v2.5 (Danny Stable Build)
// ============================================================================
//
// Verwerkt ALLE twists in BattleBox:
//
//  • galaxy          → ranking omdraaien
//  • moneygun        → eliminate target direct
//  • immune          → maakt speler immune
//  • bomb            → random enemy eliminatie
//  • diamondpistol   → iedereen behalve target killen
//
// Integraties:
//  - twist-inventory.ts
//  - twist-definitions.ts
//  - game-engine.ts (arena)
//  - admin-twist-engine.ts
//  - server.ts overlay events
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

// Zoek user in DB
async function findUserByUsername(raw: string) {
  const clean = raw.replace("@", "").trim().toLowerCase();

  const q = await pool.query(
    `
      SELECT tiktok_id, username, display_name
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
    `,
    [clean]
  );

  if (!q.rows.length) return null;

  return {
    id: q.rows[0].tiktok_id.toString(),
    username: q.rows[0].username.replace(/^@/, ""),
    display_name: q.rows[0].display_name,
  };
}

// Overlays sturen
function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

// Arena mutatie helpers
function getPlayer(id: string) {
  const arena = getArena();
  return arena.players.find(p => p.id === id) || null;
}

function setEliminated(id: string) {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return;

  p.status = "eliminated";
  emitArena();
}

function setImmune(id: string) {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  if (!p) return;

  if (!p.boosters.includes("immune")) p.boosters.push("immune");
  emitArena();
}

function hasImmune(id: string) {
  const arena = getArena();
  const p = arena.players.find(x => x.id === id);
  return p?.boosters.includes("immune") ?? false;
}

// ============================================================================
// TWIST IMPLEMENTATIES
// ============================================================================

async function applyGalaxy(senderName: string) {
  const arena = getArena();
  const sorted = [...arena.players].sort(
    (a, b) => a.diamonds - b.diamonds
  );

  // Omdraaien
  arena.players.splice(0, arena.players.length, ...sorted);
  emitArena();

  emitLog({
    type: "twist",
    message: `${senderName} draaide de ranking om met GALAXY!`,
  });

  emitOverlay("galaxy", { by: senderName });
}

async function applyMoneyGun(senderName: string, target: any) {
  if (!target) return;

  if (hasImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde MoneyGun op ${target.display_name}, maar die is IMMUNE!`,
    });
    return;
  }

  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${senderName} elimineerde ${target.display_name} met MoneyGun!`,
  });

  emitOverlay("moneygun", {
    by: senderName,
    target: target.display_name,
  });
}

async function applyImmune(senderName: string, target: any) {
  if (!target) return;

  setImmune(target.id);

  emitLog({
    type: "twist",
    message: `${senderName} gaf IMMUNE aan ${target.display_name}!`,
  });

  emitOverlay("immune", {
    by: senderName,
    target: target.display_name,
  });
}

async function applyBomb(senderName: string) {
  const arena = getArena();
  const candidates = arena.players.filter(
    p => p.status === "alive" && !hasImmune(p.id)
  );

  if (!candidates.length) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde een Bomb, maar geen targets!`,
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
    pool: candidates.map(x => x.display_name),
  });
}

async function applyDiamondPistol(senderName: string, survivor: any) {
  if (!survivor) return;

  const arena = getArena();

  for (const p of arena.players) {
    if (p.id !== survivor.id) p.status = "eliminated";
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
      message: `${senderName} probeerde ${twist}, maar buiten een ronde.`,
    });
    return;
  }

  // Check inventory
  const consumed = await consumeTwistFromUser(senderId, twist);
  if (!consumed) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${TWIST_MAP[twist].giftName}, maar heeft geen twist.`,
    });
    return;
  }

  let target = null;

  if (TWIST_MAP[twist].requiresTarget) {
    if (!targetUsername) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${TWIST_MAP[twist].giftName} zonder target.`,
      });
      return;
    }

    target = await findUserByUsername(targetUsername);
    if (!target) {
      emitLog({
        type: "twist",
        message: `${senderName} probeerde ${TWIST_MAP[twist].giftName} op '${targetUsername}', maar speler bestaat niet.`,
      });
      return;
    }
  }

  // Execute twist
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
  }
}

// ============================================================================
// TWIST VIA GIFT
// ============================================================================

export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Ontving twist: ${TWIST_MAP[twist].giftName}`,
  });
}

// ============================================================================
// PARSER (!use moneygun @user)
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
