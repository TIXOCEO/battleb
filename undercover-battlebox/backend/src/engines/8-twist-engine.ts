// ============================================================================
// 8-twist-engine.ts — Twist Engine v3.1 (Danny Stable, Diamonds-Agnostic)
// ============================================================================
//
// ✔ Does NOT use player.diamonds (arena v13 has no diamonds field)
// ✔ Galaxy fallback = sort on display_name (stable, predictable)
// ✔ Fully compatible with Arena Engine v5 (score only)
// ✔ MoneyGun, Bomb, Heal, Immune, DiamondPistol unchanged
// ✔ No TypeScript errors
//
// ============================================================================

import { io, emitLog } from "../server";
import { getArena, emitArena } from "./5-game-engine";

import {
  giveTwistToUser,
  consumeTwistFromUser,
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

// Zoek user
async function findUserByUsername(raw: string) {
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
    display_name: q.rows[0].display_name,
  };
}

function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

function getPlayer(id: string) {
  const arena = getArena();
  return arena.players.find((p) => p.id === id) || null;
}

function isEliminated(id: string) {
  const p = getPlayer(id);
  return p?.status === "eliminated";
}

function setEliminated(id: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return;
  p.status = "eliminated";
  emitArena();
}

function setAlive(id: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return;
  p.status = "alive";
  emitArena();
}

function hasImmune(id: string) {
  const p = getPlayer(id);
  return p?.boosters.includes("immune") ?? false;
}

function applyImmuneStatus(id: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return;

  if (!p.boosters.includes("immune")) p.boosters.push("immune");
  emitArena();
}

// ============================================================================
// TWISTS
// ============================================================================

// GALAXY — sorteer op naam (fallback sinds arena v13 geen diamonds meer heeft)
async function applyGalaxy(sender: string) {
  const arena = getArena();

  const sorted = [...arena.players].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );

  arena.players.splice(0, arena.players.length, ...sorted);
  emitArena();

  emitLog({
    type: "twist",
    message: `${sender} draaide de ranking om met GALAXY!`,
  });

  emitOverlay("galaxy", { by: sender });
}

// MONEY GUN
async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  if (hasImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde MoneyGun op ${target.display_name}, maar IMMUNE!`,
    });
    return;
  }

  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${sender} elimineerde ${target.display_name} met MoneyGun!`,
  });

  emitOverlay("moneygun", {
    by: sender,
    target: target.display_name,
  });
}

// BOMB
async function applyBomb(sender: string) {
  const arena = getArena();

  const candidates = arena.players.filter(
    (p) => p.status === "alive" && !hasImmune(p.id)
  );

  if (!candidates.length) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde Bomb, maar geen targets.`,
    });
    return;
  }

  const target =
    candidates[Math.floor(Math.random() * candidates.length)];

  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${sender} BOMB → ${target.display_name}!`,
  });

  emitOverlay("bomb", {
    by: sender,
    target: target.display_name,
    pool: candidates.map((p) => p.display_name),
  });
}

// IMMUNE
async function applyImmune(sender: string, target: any) {
  if (!target) return;

  applyImmuneStatus(target.id);

  emitLog({
    type: "twist",
    message: `${sender} gaf IMMUNE aan ${target.display_name}!`,
  });

  emitOverlay("immune", {
    by: sender,
    target: target.display_name,
  });
}

// HEAL
async function applyHeal(sender: string, target: any) {
  if (!target) return;

  if (!isEliminated(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde HEAL op ${target.display_name}, maar niet eliminated.`,
    });
    return;
  }

  setAlive(target.id);

  emitLog({
    type: "twist",
    message: `${sender} HEAL → ${target.display_name} is terug!`,
  });

  emitOverlay("heal", {
    by: sender,
    target: target.display_name,
  });
}

// DIAMOND PISTOL
async function applyDiamondPistol(sender: string, survivor: any) {
  if (!survivor) return;

  const arena = getArena();

  for (const p of arena.players) {
    p.status = p.id === survivor.id ? "alive" : "eliminated";
  }

  emitArena();

  emitLog({
    type: "twist",
    message: `${sender} DIAMOND PISTOL → ${survivor.display_name} overleeft alleen!`,
  });

  emitOverlay("diamondpistol", {
    by: sender,
    survivor: survivor.display_name,
  });
}

// ============================================================================
// MAIN — EXECUTE TWIST
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
      message: `${senderName} probeerde ${twist}, maar buiten ronde.`,
    });
    return;
  }

  const consumed = await consumeTwistFromUser(senderId, twist);
  if (!consumed) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${
        TWIST_MAP[twist].giftName
      }, maar heeft geen twist.`,
    });
    return;
  }

  let target: any = null;

  if (TWIST_MAP[twist].requiresTarget) {
    if (!rawTarget) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${
          TWIST_MAP[twist].giftName
        } zonder doelwit.`,
      });
      return;
    }

    target = await findUserByUsername(rawTarget);
    if (!target) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${
          TWIST_MAP[twist].giftName
        } op '${rawTarget}', bestaat niet.`,
      });
      return;
    }
  }

  switch (twist) {
    case "galaxy":
      return applyGalaxy(senderName);
    case "moneygun":
      return applyMoneyGun(senderName, target);
    case "bomb":
      return applyBomb(senderName);
    case "immune":
      return applyImmune(senderName, target);
    case "heal":
      return applyHeal(senderName, target);
    case "diamondpistol":
      return applyDiamondPistol(senderName, target);
    case "shield":
      return applyImmune(senderName, target);
  }
}

// ============================================================================
// Twist via gift
// ============================================================================

export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Ontving twist: ${TWIST_MAP[twist].giftName}`,
  });
}

// ============================================================================
// Parser (!use heal @user)
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
