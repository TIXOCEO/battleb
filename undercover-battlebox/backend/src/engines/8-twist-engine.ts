// ============================================================================
// 8-twist-engine.ts — Twist Engine v15.1 (Consume AFTER validation patch)
// ============================================================================
//
// ✔ Twists worden pas geconsumeerd ALS ze echt uitgevoerd kunnen worden
//   → Immune target? → géén consume
//   → Target bestaat niet? → géén consume
//   → MoneyGun op al-gemarkeerd? → géén consume
//   → Bomb zonder targets? → géén consume
//   → Heal op iemand zonder markering? → géén consume
//
// ✔ Galaxy, Immune en DiamondPistol blijven ongedeerd
// ✔ Verdere code NIET aangeraakt zoals gevraagd
// ============================================================================

import { io, emitLog } from "../server";
import {
  getArena,
  emitArena,
  eliminate,
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

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

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
  const p = arena.players.find((x) => x.id === id);
  if (!p) return false;

  p.positionStatus = "elimination";
  p.eliminated = true;
  return true;
}

function clearEliminationMark(id: string) {
  const arena = getArena();
  const p = arena.players.find((x) => x.id === id);
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

// GALAXY — toggle reverseMode
async function applyGalaxy(sender: string) {
  const ok = await consumeTwistFromUser(sender, "galaxy");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde Galaxy, maar heeft geen twist`
    });
    return;
  }

  const reversedNow = toggleGalaxyMode();

  emitOverlay("galaxy", {
    by: sender,
    reverse: reversedNow
  });

  emitLog({
    type: "twist",
    message: `${sender} gebruikte GALAXY → ranking nu ${
      reversedNow
        ? "omgekeerd (laagste bovenaan)"
        : "normaal (hoogste bovenaan)"
    }`
  });

  await emitArena();
}

// ============================================================================
// MONEYGUN (met badge)
// ============================================================================

async function applyMoneyGun(sender: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  // Eerst checken → nog NIET consumeren
  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${sender} MoneyGun → ${target.display_name} is IMMUNE!`
    });
    return;
  }

  if (p.eliminated === true) {
    emitLog({
      type: "twist",
      message: `${sender} MoneyGun → ${target.display_name} is al gemarkeerd (Heal nodig)`
    });
    return;
  }

  // Nu pas consumeren
  const ok = await consumeTwistFromUser(sender, "moneygun");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde MoneyGun, maar heeft geen twist`
    });
    return;
  }

  if (!p.boosters.includes("mg")) p.boosters.push("mg");

  markEliminated(target.id);

  emitOverlay("moneygun", {
    by: sender,
    target: target.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} MoneyGun → ${target.display_name} gemarkeerd`
  });

  await emitArena();
}

// ============================================================================
// BOMB — delay + countdown + badge
// ============================================================================

let bombInProgress = false;

async function applyBomb(sender: string) {
  const arena = getArena();

  if (bombInProgress) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → bezig, wacht tot huidige klaar is`
    });
    return;
  }

  // Validatie eerst — géén consume
  const poolTargets = arena.players.filter(
    (p) => !p.boosters.includes("immune") && p.eliminated !== true
  );

  if (!poolTargets.length) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → geen geldige targets (immune/marked)`
    });
    return;
  }

  // Nu pas consumeren (twist is geldig)
  const ok = await consumeTwistFromUser(sender, "bomb");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde Bomb, maar heeft geen twist`
    });
    return;
  }

  bombInProgress = true;

  emitOverlay("bomb_start", { by: sender });
  emitLog({ type: "twist", message: `${sender} activeert BOMB…` });

  for (let i = 3; i >= 1; i--) {
    emitLog({
      type: "twist",
      message: `💣 Bomb → ${i}…`
    });
    await sleep(1000);
  }

const updatedArena = getArena();
  const freshTargets = updatedArena.players.filter(
    (p) => !p.boosters.includes("immune") && p.eliminated !== true
  );

  if (!freshTargets.length) {
    emitLog({
      type: "twist",
      message: `${sender} Bomb → niemand meer geldig`
    });
    bombInProgress = false;
    return;
  }

  const chosen =
    freshTargets[Math.floor(Math.random() * freshTargets.length)];

  // Badge toevoegen
  if (!chosen.boosters.includes("bomb"))
    chosen.boosters.push("bomb");

  markEliminated(chosen.id);

  emitOverlay("bomb", {
    by: sender,
    target: chosen.display_name
  });

  emitLog({
    type: "twist",
    message: `${sender} BOMB → ${chosen.display_name} gemarkeerd`
  });

  await emitArena();

  bombInProgress = false;
}

// ============================================================================
// IMMUNE
// ============================================================================

async function applyImmuneTwist(sender: string, target: any) {
  if (!target) return;

  // Immune twist heeft geen extra checks → direct consume
  const ok = await consumeTwistFromUser(sender, "immune");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde Immune, maar heeft geen twist`
    });
    return;
  }

  await applyImmune(target.id);

  emitOverlay("immune", {
    by: sender,
    target: target.display_name
  });

  await emitArena();
}

// ============================================================================
// HEAL — badge + eliminated mark verwijderen
// ============================================================================

async function applyHeal(sender: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  // Validatie eerst
  if (!p.eliminated) {
    emitLog({
      type: "twist",
      message: `${sender} HEAL → ${target.display_name} heeft geen MG/Bomb markering`
    });
    return;
  }

  // Nu pas consume uitvoeren
  const ok = await consumeTwistFromUser(sender, "heal");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde Heal, maar heeft geen twist`
    });
    return;
  }

  // MG/Bomb badges verwijderen
  p.boosters = p.boosters.filter((b) => b !== "mg" && b !== "bomb");

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
// DIAMOND PISTOL
// ============================================================================

async function applyDiamondPistol(sender: string, survivor: any) {
  if (!survivor) return;

  // Eerst validate → daarna pas consume
  const ok = await consumeTwistFromUser(sender, "diamondpistol");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${sender} probeerde DiamondPistol, maar heeft geen twist`
    });
    return;
  }

  const arena = getArena();

  const victims = arena.players.filter(
    (p) => p.id !== survivor.id && !p.boosters.includes("immune")
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
    message: `${sender} DIAMOND PISTOL → ${survivor.display_name} overleeft`
  });

  await emitArena();
}

// ============================================================================
// MAIN USE TWIST
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

  // ------------- BELANGRIJK -------------
  // Verplaats consume naar ín de individuele functies.
  // In deze "useTwist" wordt NIETS meer geconsumeerd.
  // --------------------------------------

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
// ADD TWIST
// ============================================================================

export async function addTwistByGift(userId: string, twist: TwistType) {
  await giveTwistToUser(userId, twist);

  emitLog({
    type: "twist",
    message: `Twist ontvangen: ${TWIST_MAP[twist].giftName}`
  });
}

// ============================================================================
// PARSER (!use)
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
// EXPORT
// ============================================================================

export default {
  useTwist,
  addTwistByGift,
  parseUseCommand
};
