// ============================================================================
// 8-twist-engine.ts — Twist Engine v14.0 (Perfect for Arena Engine v14.0)
// Danny Stable — boosters[] + eliminated-flag compatible
// Eliminations use arena.eliminate()
// Immune = boosters.includes("immune") + positionStatus="immune"
// Heal respawns full ArenaPlayer object identical to arenaJoin()
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  eliminate      // verwijdert speler uit arena
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

function emitOverlay(name: string, data: any) {
  io.emit(`twist:${name}`, data);
}

// ============================================================================
// TWISTS
// ============================================================================

// GALAXY — alfabetisch shuffle
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

// MONEYGUN — directe eliminatie
async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} MoneyGun → ${target.display_name} is IMMUNE!`
    });
    return;
  }

  await eliminate(target.username);

  emitOverlay("moneygun", {
    by: sender,
    target: target.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} MoneyGun → ${target.display_name} geëlimineerd!`
  });

  await emitArena();
}

// BOMB — random non-immune eliminatie
async function applyBomb(sender: string) {
  const arena = getArena();

  const pool = arena.players.filter(
    (p) => !p.boosters.includes("immune")
  );

  if (!pool.length) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → geen geldige targets`
    });
    return;
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];

  await eliminate(chosen.username);

  emitOverlay("bomb", {
    by: sender,
    target: chosen.display_name,
    pool: pool.map((p) => p.display_name)
  });

  emitLog({
    type: "twist",
    message: `${sender} BOMB → ${chosen.display_name}!`
  });

  await emitArena();
}

// IMMUNE — flag toevoegen
async function applyImmuneTwist(sender: string, target: any) {
  if (!target) return;

  await applyImmune(target.id);

  emitOverlay("immune", {
    by: sender,
    target: target.display_name
  });
}

// HEAL — speler terugplaatsen in arena
async function applyHeal(sender: string, target: any) {
  if (!target) return;

  const arena = getArena();

  // Als speler al in arena zit → skip
  if (arena.players.some((p) => p.id === target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} HEAL → ${target.display_name} zit al in arena`
    });
    return;
  }

  // score ophalen
  const q = await pool.query(
    `
      SELECT COALESCE(SUM(diamonds),0) AS score
      FROM gifts
      WHERE receiver_id=$1 AND game_id=$2
    `,
    [BigInt(target.id), (io as any).currentGameId]
  );

  const score = Number(q.rows[0]?.score || 0);

  // volledig ArenaPlayer object terugplaatsen
  arena.players.push({
    id: target.id,
    username: target.username,
    display_name: target.display_name,
    score,
    boosters: [],
    eliminated: false,
    positionStatus: "alive"
  });

  emitOverlay("heal", {
    by: sender,
    target: target.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} HEAL → ${target.display_name} is terug!`
  });

  await emitArena();
}

// DIAMOND PISTOL — alleen survivor blijft over
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
      message: `${senderName} probeerde ${twist}, maar buiten ronde`
    });
    return;
  }

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
    message: `Twist ontvangen: ${TWIST_MAP[twist].giftName}`
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
