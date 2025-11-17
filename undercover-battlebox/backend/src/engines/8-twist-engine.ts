// ============================================================================
// 8-twist-engine.ts — Twist Engine v1.0 (FINAL PRODUCTION VERSION)
// ============================================================================
//
// Twists worden NOOIT direct verwerkt in arena.players.
// Alles wordt opgeslagen als pending flags → toegepast in endRound().
//
// Enige uitzondering:
//   - Galaxy (reversed ranking) → direct, want het verandert alleen sorting.
//
// Dit ontwerp is 100% compatibel met:
//   - Arena Engine v2.4 (immutable snapshot, mutate-only inside engine)
//   - jouw eliminate-regels (end-round only)
//   - immuniteit en heal-regels
//   - Diamond Pistol overwint ALLES
//
// ============================================================================

import { io, emitLog, emitArena } from "../server";
import { getArena } from "./5-game-engine";

import {
  addTwistToUser,
  userHasTwist,
  consumeTwistFromUser,
} from "./twist-inventory";

import {
  TWIST_MAP,
  TwistType,
  findTwistByAlias,
} from "./twist-definitions";

import pool from "../db";
import { getOrUpdateUser } from "./2-user-engine";

// ============================================================================
// PENDING STRUCTURE
// ============================================================================
//
// Deze flags bepalen wat er GEBEURT BIJ END-ROUND:
// - pendingElimination[id] = true → speler wordt geëlimineerd
// - pendingImmune[id] = true → speler is immuun (blokkeert eliminatie-twists)
// - pendingHeal[id] = true → heal verwijdert 1 pendingElimination
// - pendingDiamondPistol = id van target → override alles
// - pendingReverseRanking = true → sort reversed (Galaxy)
//
// De arena-engine v2.4 pakt deze flags op tijdens endRound() → jouw nieuwe
// endRound() moet deze flags uitlezen en toepassen.
//
// ============================================================================

export const pendingElimination: Record<string, boolean> = {};
export const pendingImmune: Record<string, boolean> = {};
export const pendingHeal: Record<string, boolean> = {};

export let pendingDiamondPistol: string | null = null;
export let pendingReverseRanking = false;

// ============================================================================
// HELPER: find user by @username
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

// ============================================================================
// OVERLAY EMITTER
// ============================================================================

function overlay(event: string, payload: any) {
  io.emit(`twist:${event}`, payload);
}

// ============================================================================
// 1. GALAXY — reverse ranking DIRECT
// ============================================================================

async function applyGalaxy(senderName: string) {
  pendingReverseRanking = true;

  emitLog({
    type: "twist",
    message: `${senderName} draaide de ranking om met GALAXY!`,
  });

  overlay("galaxy", { by: senderName });
}

// ============================================================================
// IMMUNITY HELPER (pending)
// ============================================================================

function isImmune(id: string): boolean {
  return !!pendingImmune[id];
}

// ============================================================================
// 2. MONEY GUN — markeer target voor eliminatie (einde ronde)
// ============================================================================

async function applyMoneyGun(senderName: string, target: any) {
  if (isImmune(target.id)) {
    emitLog({
      type: "twist",
      message: `${senderName} vuurde MoneyGun op ${target.display_name}, maar die is IMMUNE!`,
    });
    return;
  }

  pendingElimination[target.id] = true;

  emitLog({
    type: "twist",
    message: `${senderName} markeerde ${target.display_name} voor eliminatie (MoneyGun)!`,
  });

  overlay("moneygun", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// 3. IMMUNE — geef immuniteit (blokkeert enkel eliminatie-twists)
// ============================================================================

async function applyImmune(senderName: string, target: any) {
  pendingImmune[target.id] = true;

  emitLog({
    type: "twist",
    message: `${senderName} gaf IMMUNE aan ${target.display_name}!`,
  });

  overlay("immune", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// 4. HEAL — verwijdert 1 pending elimination van target
// ============================================================================

async function applyHeal(senderName: string, target: any) {
  if (!pendingElimination[target.id]) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${target.display_name} te healen, maar die heeft geen pending eliminatie.`,
    });
    return;
  }

  delete pendingElimination[target.id];

  emitLog({
    type: "twist",
    message: `${senderName} healde ${target.display_name}! Eliminatie markering verwijderd.`,
  });

  overlay("heal", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// 5. DIAMOND PISTOL — iedereen behalve target geëlimineerd
// ============================================================================

async function applyDiamondPistol(senderName: string, target: any) {
  pendingDiamondPistol = target.id;

  emitLog({
    type: "twist",
    message: `${senderName} gebruikte DIAMOND PISTOL! Alleen ${target.display_name} overleeft.`,
  });

  overlay("diamondpistol", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// 6. BOMB — random non-immune active speler
// ============================================================================

async function applyBomb(senderName: string) {
  const arena = getArena();

  const candidates = arena.players
    .filter((p) => !isImmune(p.id))
    .map((p) => p);

  if (candidates.length === 0) {
    emitLog({
      type: "twist",
      message: `${senderName} gebruikte BOMB, maar er zijn geen geldige targets.`,
    });
    return;
  }

  const target =
    candidates[Math.floor(Math.random() * candidates.length)];

  pendingElimination[target.id] = true;

  emitLog({
    type: "twist",
    message: `${senderName} bombardeerde ${target.display_name}!`,
  });

  overlay("bomb", {
    by: senderName,
    target: target.display_name,
  });
}

// ============================================================================
// MAIN PROCESSOR
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

  // Heeft gebruiker twist?
  if (!(await userHasTwist(senderId, twist))) {
    emitLog({
      type: "twist",
      message: `${senderName} probeerde ${twist}, maar heeft geen twist tegoed.`,
    });
    return;
  }

  // Verbruik twist
  await consumeTwistFromUser(senderId, twist);

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

  switch (twist) {
    case "galaxy":
      return applyGalaxy(senderName);

    case "moneygun":
      return applyMoneyGun(senderName, target);

    case "immune":
      return applyImmune(senderName, target);

    case "heal":
      return applyHeal(senderName, target);

    case "diamond_pistol":
      return applyDiamondPistol(senderName, target);

    case "bomb":
      return applyBomb(senderName);
  }
}

// ============================================================================
// ADD TWIST (gift-engine)
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
    message: `${display_name} kocht ${amount}× ${TWIST_MAP[twist].giftName}.`,
  });
}

// ============================================================================
// PARSE CHAT (!use ...)
// ============================================================================

export async function parseUseCommand(
  senderId: string,
  senderName: string,
  message: string
) {
  const parts = message.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!use") return;

  const alias = parts[1]?.toLowerCase();
  const twist = findTwistByAlias(alias);
  if (!twist) return;

  const target = parts[2]?.replace("@", "");

  await useTwist(senderId, senderName, twist, target);
}
