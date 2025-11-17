// ============================================================================
// 8-twist-engine.ts — Twist Engine v3.0 (Danny Stable Build)
// ============================================================================
//
// ✔ FULL SUPPORT: Galaxy, MoneyGun, Bomb, Shield, Immune, Heal, DiamondPistol
// ✔ Volledige integratie met arena-engine v4.x
// ✔ Live overlays voor OBS
// ✔ Live logs voor admin panel
// ✔ Geen race conditions
// ✔ Targeted twists correct
// ✔ Heal = ALIVE herstellen (anti-MoneyGun / anti-Bomb)
// ✔ Immune = aanval blokkeren
// ✔ DiamondPistol = slechts 1 overlevende
//
// ============================================================================

import { io, emitLog, emitArena } from "../server";
import { getArena } from "./5-game-engine";

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

// Zoek user in database op username
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

// Overlay event
function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

// Arena lookup
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
// TWIST IMPLEMENTATIES
// ============================================================================

// 1 — GALAXY
async function applyGalaxy(sender: string) {
  const arena = getArena();

  const sorted = [...arena.players].sort(
    (a, b) => a.diamonds - b.diamonds
  );

  arena.players.splice(0, arena.players.length, ...sorted);
  emitArena();

  emitLog({
    type: "twist",
    message: `${sender} draaide de ranking om met GALAXY!`,
  });

  emitOverlay("galaxy", { by: sender });
}

// 2 — MONEY GUN (direct eliminate)
async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  if (hasImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde MoneyGun op ${target.display_name}, maar die is IMMUNE!`,
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

// 3 — BOMB (random enemy)
async function applyBomb(sender: string) {
  const arena = getArena();

  const candidates = arena.players.filter(
    (p) => p.status === "alive" && !hasImmune(p.id)
  );

  if (!candidates.length) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde een Bomb, maar geen targets!`,
    });
    return;
  }

  const target =
    candidates[Math.floor(Math.random() * candidates.length)];

  setEliminated(target.id);

  emitLog({
    type: "twist",
    message: `${sender} bombardeerde ${target.display_name}!`,
  });

  emitOverlay("bomb", {
    by: sender,
    target: target.display_name,
    pool: candidates.map((p) => p.display_name),
  });
}

// 4 — IMMUNE
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

// 5 — HEAL (herstel ALIVE)
async function applyHeal(sender: string, target: any) {
  if (!target) return;

  if (!isEliminated(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde HEAL op ${target.display_name}, maar die is niet eliminated.`,
    });
    return;
  }

  setAlive(target.id);

  emitLog({
    type: "twist",
    message: `${sender} HEAL → ${target.display_name} is weer ALIVE!`,
  });

  emitOverlay("heal", {
    by: sender,
    target: target.display_name,
  });
}

// 6 — DIAMOND PISTOL (alleen target overleeft)
async function applyDiamondPistol(sender: string, survivor: any) {
  if (!survivor) return;

  const arena = getArena();

  for (const p of arena.players) {
    if (p.id !== survivor.id) p.status = "eliminated";
    else p.status = "alive";
  }

  emitArena();

  emitLog({
    type: "twist",
    message: `${sender} gebruikte DIAMOND PISTOL! Alleen ${survivor.display_name} overleeft.`,
  });

  emitOverlay("diamondpistol", {
    by: sender,
    survivor: survivor.display_name,
  });
}

// ============================================================================
// MAIN — execute twist
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
      message: `${senderName} probeerde ${twist}, maar buiten een ronde.`,
    });
    return;
  }

  // user must own twist
  const consumed = await consumeTwistFromUser(senderId, twist);
  if (!consumed) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${TWIST_MAP[twist].giftName}, maar heeft geen twist.`,
    });
    return;
  }

  let target: any = null;

  if (TWIST_MAP[twist].requiresTarget) {
    if (!rawTarget) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${TWIST_MAP[twist].giftName} zonder doelwit.`,
      });
      return;
    }

    target = await findUserByUsername(rawTarget);
    if (!target) {
      emitLog({
        type: "twist",
        message: `${senderName} gebruikte ${TWIST_MAP[twist].giftName} op '${rawTarget}', maar speler bestaat niet.`,
      });
      return;
    }
  }

  // execute twist
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
      // wordt elders gebruikt als booster, maar blijft ondersteund
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
// Parser — !use heal @user
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
