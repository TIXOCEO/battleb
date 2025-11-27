// ============================================================================
// 8-twist-engine.ts — Twist Engine v4.0 (Compatible with Arena Engine v13.1)
// Danny Stable — NO player.status, NO boosters, NO diamonds fields
// Eliminations now remove players from arena (consistent with eliminate())
// Immune = positionStatus = "immune"
// Galaxy = alphabetical reshuffle (fallback ranking)
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  eliminate,       // use arena eliminate logic
} from "./5-game-engine";

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
// BASIC HELPERS
// ============================================================================

// Zoek user in database
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
    display_name: q.rows[0].display_name,
  };
}

// Vind speler in arena
function getArenaPlayer(id: string) {
  return getArena().players.find((p) => p.id === id) || null;
}

function isImmune(id: string) {
  const p = getArenaPlayer(id);
  return p?.positionStatus === "immune";
}

async function applyImmune(id: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
  if (!p) return;

  p.positionStatus = "immune";

  emitLog({
    type: "twist",
    message: `${p.display_name} kreeg IMMUNE`,
  });

  emitArena();
}

// ============================================================================
// TWIST ACTIONS
// ============================================================================

// GALAXY — sorteer spelers op naam (fallback ranking)
async function applyGalaxy(sender: string) {
  const arena = getArena();

  const sorted = [...arena.players].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );

  arena.players.splice(0, arena.players.length, ...sorted);

  emitLog({
    type: "twist",
    message: `${sender} gebruikte GALAXY! (alfabetische shuffle)`,
  });

  emitOverlay("galaxy", { by: sender });

  emitArena();
}

// MONEYGUN — directe eliminatie
async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} MoneyGun → ${target.display_name} is IMMUNE!`,
    });
    return;
  }

  await eliminate(target.username);

  emitLog({
    type: "twist",
    message: `${sender} MoneyGun → ${target.display_name} geëlimineerd!`,
  });

  emitOverlay("moneygun", {
    by: sender,
    target: target.display_name,
  });

  await emitArena();
}

// BOMB — elimineert random non-immune alive speler
async function applyBomb(sender: string) {
  const arena = getArena();

  const alive = arena.players.filter(
    (p) => p.positionStatus !== "immune"
  );

  if (!alive.length) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → geen geldige targets.`,
    });
    return;
  }

  const chosen = alive[Math.floor(Math.random() * alive.length)];

  await eliminate(chosen.username);

  emitLog({
    type: "twist",
    message: `${sender} BOMB → ${chosen.display_name}!`,
  });

  emitOverlay("bomb", {
    by: sender,
    target: chosen.display_name,
    pool: alive.map((p) => p.display_name),
  });

  await emitArena();
}

// IMMUNE — zet speler op immune
async function applyImmuneTwist(sender: string, target: any) {
  if (!target) return;

  await applyImmune(target.id);

  emitOverlay("immune", {
    by: sender,
    target: target.display_name,
  });
}

// HEAL — speler terug in arena zetten (eenvoudige re-add)
async function applyHeal(sender: string, target: any) {
  if (!target) return;

  // check of speler niet al in arena zit
  const arena = getArena();
  const exists = arena.players.some((p) => p.id === target.id);

  if (exists) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde HEAL op ${target.display_name}, maar al in arena.`,
    });
    return;
  }

  // score ophalen
  const scoreQ = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1 AND game_id=$2
    `,
    [BigInt(target.id), (io as any).currentGameId]
  );

  const score = Number(scoreQ.rows[0]?.score || 0);

  // terugplaatsen
  arena.players.push({
    id: target.id,
    username: target.username,
    display_name: target.display_name,
    score,
    positionStatus: "alive",
  });

  emitLog({
    type: "twist",
    message: `${sender} HEAL → ${target.display_name} is terug!`,
  });

  emitOverlay("heal", {
    by: sender,
    target: target.display_name,
  });

  await emitArena();
}

// DIAMOND PISTOL — alle spelers behalve 1 elimineren
async function applyDiamondPistol(sender: string, survivor: any) {
  if (!survivor) return;

  const arena = getArena();

  // iedereen behalve survivor elimineren
  const toEliminate = arena.players.filter(
    (p) => p.id !== survivor.id && p.positionStatus !== "immune"
  );

  for (const p of toEliminate) {
    await eliminate(p.username);
  }

  emitLog({
    type: "twist",
    message: `${sender} DIAMOND PISTOL → ${survivor.display_name} overleeft als enige!`,
  });

  emitOverlay("diamondpistol", {
    by: sender,
    survivor: survivor.display_name,
  });

  await emitArena();
}

// ============================================================================
// OVERLAY EMITTER
// ============================================================================

function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

// ============================================================================
// MAIN — USE TWIST
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

  // consume inventory item
  const ok = await consumeTwistFromUser(senderId, twist);
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${
        TWIST_MAP[twist].giftName
      }, maar heeft geen twist.`,
    });
    return;
  }

  let target = null;

  if (TWIST_MAP[twist].requiresTarget) {
    target = await findUser(rawTarget || "");
    if (!target) {
      emitLog({
        type: "twist",
        message: `Twist failed: target '${rawTarget}' bestaat niet.`,
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
      return applyImmuneTwist(senderName, target);

    case "heal":
      return applyHeal(senderName, target);

    case "diamondpistol":
      return applyDiamondPistol(senderName, target);
  }
}

// ============================================================================
// ADD TWIST WHEN RECEIVING GIFT
// ============================================================================

export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Ontving twist: ${TWIST_MAP[twist].giftName}`,
  });
}

// ============================================================================
// PARSER (!use heal @user)
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
