// ============================================================================
// 8-twist-engine.ts — Twist Engine v16.1 (Inventory FIX + Breaker Patch)
// ============================================================================
//
// ✔ FIX: consumeTwistFromUser gebruikt nu senderId (tiktok_id) i.p.v. senderName
// ✔ ALL applyX calls gepatcht
// ✔ UI / Logs blijven senderName tonen
// ✔ BREAKER, MG, Bomb, Immune, Heal, DiamondPistol werken nu correct
//
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


// GALAXY — toggle reverseMode (FIXED → consume using senderId)
async function applyGalaxy(senderId: string, senderName: string) {
  const ok = await consumeTwistFromUser(senderId, "galaxy");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Galaxy, maar heeft geen twist`
    });
    return;
  }

  const reversedNow = toggleGalaxyMode();

  emitOverlay("galaxy", {
    by: senderName,
    reverse: reversedNow
  });

  emitLog({
    type: "twist",
    message: `${senderName} gebruikte GALAXY → ranking nu ${
      reversedNow
        ? "omgekeerd (laagste bovenaan)"
        : "normaal (hoogste bovenaan)"
    }`
  });

  await emitArena();
}


// ============================================================================
// MONEYGUN (FIXED: consume senderId)
// ============================================================================

async function applyMoneyGun(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  // IMMUNE blokkeert
  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${senderName} MoneyGun → ${target.display_name} is IMMUNE!`
    });
    return;
  }

  if (p.eliminated === true) {
    emitLog({
      type: "twist",
      message: `${senderName} MoneyGun → ${target.display_name} is al gemarkeerd (Heal nodig)`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "moneygun");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde MoneyGun, maar heeft geen twist`
    });
    return;
  }

  if (!p.boosters.includes("mg")) p.boosters.push("mg");
  markEliminated(target.id);

  emitOverlay("moneygun", { by: senderName, target: target.display_name });

  emitLog({
    type: "twist",
    message: `${senderName} MoneyGun → ${target.display_name} gemarkeerd`
  });

  await emitArena();
}


// ============================================================================
// BOMB (FIXED: consume senderId)
// ============================================================================

let bombInProgress = false;

async function applyBomb(senderId: string, senderName: string) {
  const arena = getArena();

  if (bombInProgress) {
    emitLog({
      type: "twist",
      message: `${senderName} Bomb → bezig, wacht tot huidige klaar is`
    });
    return;
  }

  const poolTargets = arena.players.filter(
    (p) => !p.boosters.includes("immune") && p.eliminated !== true
  );

  if (!poolTargets.length) {
    emitLog({
      type: "twist",
      message: `${senderName} Bomb → geen geldige targets (immune/marked)`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "bomb");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Bomb, maar heeft geen twist`
    });
    return;
  }

  bombInProgress = true;

  emitOverlay("bomb_start", { by: senderName });
  emitLog({ type: "twist", message: `${senderName} activeert BOMB…` });

  for (let i = 3; i >= 1; i--) {
    emitLog({ type: "twist", message: `💣 Bomb → ${i}…` });
    await sleep(1000);
  }

  const updated = getArena();
  const valid = updated.players.filter(
    (p) => !p.boosters.includes("immune") && p.eliminated !== true
  );

  if (!valid.length) {
    emitLog({
      type: "twist",
      message: `${senderName} Bomb → niemand meer geldig`
    });
    bombInProgress = false;
    return;
  }

  const chosen = valid[Math.floor(Math.random() * valid.length)];

  if (!chosen.boosters.includes("bomb")) chosen.boosters.push("bomb");
  markEliminated(chosen.id);

  emitOverlay("bomb", { by: senderName, target: chosen.display_name });

  emitLog({
    type: "twist",
    message: `${senderName} BOMB → ${chosen.display_name} gemarkeerd`
  });

  await emitArena();

  bombInProgress = false;
}


// ============================================================================
// IMMUNE (FIXED consume senderId)
// ============================================================================

async function applyImmuneTwist(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const ok = await consumeTwistFromUser(senderId, "immune");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Immune, maar heeft geen twist`
    });
    return;
  }

  await applyImmune(target.id);

  emitOverlay("immune", { by: senderName, target: target.display_name });
  await emitArena();
}


// ============================================================================
// HEAL (FIXED consume senderId)
// ============================================================================

async function applyHeal(senderId: string, senderName: string, target: any) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  if (!p.eliminated) {
    emitLog({
      type: "twist",
      message: `${senderName} HEAL → ${target.display_name} heeft geen MG/Bomb markering`
    });
    return;
  }

  const ok = await consumeTwistFromUser(senderId, "heal");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Heal, maar heeft geen twist`
    });
    return;
  }

  p.boosters = p.boosters.filter((b) => b !== "mg" && b !== "bomb");
  clearEliminationMark(target.id);

  emitOverlay("heal", { by: senderName, target: target.display_name });

  emitLog({
    type: "twist",
    message: `${senderName} HEAL → ${target.display_name} is hersteld`
  });

  await emitArena();
}

// ============================================================================
// ★★★★★ BREAKER — Nieuw (FIXED consume senderId) ★★★★★
// ============================================================================
//
// 1 breaker  → cracked shield   (breakerHits = 1)
// 2 breakers → immune verwijderd + overlay “broken”
//

async function applyBreaker(
  senderId: string,
  senderName: string,
  target: any
) {
  if (!target) return;

  const arena = getArena();
  const p = arena.players.find((x) => x.id === target.id);
  if (!p) return;

  // Eerst validatie → daarna consume
  const consumed = await consumeTwistFromUser(senderId, "breaker");
  if (!consumed) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde Breaker, maar heeft geen twist`
    });
    return;
  }

  // Init value
  p.breakerHits = (p.breakerHits ?? 0) + 1;

  if (p.breakerHits === 1) {
    // cracked
    emitOverlay("breaker_cracked", { by: senderName, target: p.display_name });

    emitLog({
      type: "twist",
      message: `${senderName} BREAKER → ${p.display_name} shield CRACKED (50%)`
    });
  }

  if (p.breakerHits >= 2) {
    // volledig breken → immune verwijderen
    p.boosters = p.boosters.filter(b => b !== "immune");
    if (p.positionStatus === "immune") p.positionStatus = "alive";

    emitOverlay("breaker_broken", { by: senderName, target: p.display_name });

    emitLog({
      type: "twist",
      message: `${senderName} BREAKER → ${p.display_name} IMMUNE volledig GEBROKEN`
    });
  }

  await emitArena();
}


// ============================================================================
// DIAMOND PISTOL — *Patched + senderId consume*
// ============================================================================

async function applyDiamondPistol(
  senderId: string,
  senderName: string,
  survivor: any
) {
  if (!survivor) return;

  const arena = getArena();

  // ❌ 1) Mag maar 1× per ronde
  if (arena.diamondPistolUsed === true) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde DiamondPistol → maar deze ronde is het al gebruikt`
    });
    return;
  }

  // ❌ 2) Je kunt DP niet op jezelf gebruiken
  if (String(survivor.id) === String(senderId)) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde DiamondPistol → maar je kunt jezelf niet kiezen`
    });
    return;
  }

  // Consume (FIXED → gebruik senderId)
  const ok = await consumeTwistFromUser(senderId, "diamondpistol");
  if (!ok) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde DiamondPistol, maar heeft geen twist`
    });
    return;
  }

  // victims (immune overleeft, zoals jouw systeem)
  const victims = arena.players.filter(
    (p) => p.id !== survivor.id && !p.boosters.includes("immune")
  );

  for (const v of victims) {
    await eliminate(v.username);
  }

  // Flag voor deze ronde
  arena.diamondPistolUsed = true;

  emitOverlay("diamondpistol", {
    by: senderName,
    survivor: survivor.display_name
  });

  emitLog({
    type: "twist",
    message: `${senderName} DIAMOND PISTOL → ${survivor.display_name} overleeft`
  });

  await emitArena();
}



// ============================================================================
// MAIN USE TWIST — FIXED (gebruikt senderId overal)
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

  // Target-resolutie
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
      return applyGalaxy(senderId, senderName);

    case "moneygun":
      return applyMoneyGun(senderId, senderName, target);

    case "bomb":
      return applyBomb(senderId, senderName);

    case "immune":
      return applyImmuneTwist(senderId, senderName, target);

    case "heal":
      return applyHeal(senderId, senderName, target);

    case "diamondpistol":
      return applyDiamondPistol(senderId, senderName, target);

    case "breaker":
      return applyBreaker(senderId, senderName, target);
  }
}



// ============================================================================
// ADD TWIST (gift)
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
