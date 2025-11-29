/* ============================================================================
   twist-engine.ts — BattleBox Twist Engine v1.0
   ---------------------------------------------------------------------------
   ✔ Twist inventory per speler
   ✔ giveTwist() → gifts & admin
   ✔ useTwist() → chat & admin
   ✔ Volledige integratie met 5-game-engine twist flags
   ✔ Alias-resolving
   ✔ Automatische validatie
   ✔ Directe toepassing op arena
============================================================================ */

import { emitLog, io } from "../server";
import { getArena } from "../5-game-engine";
import type { ArenaPlayer } from "../5-game-engine";

/* ============================================================================
   TWIST DEFINITIES
============================================================================ */

export interface TwistDefinition {
  id: string;
  aliases: string[];
  requiresTarget: boolean;
}

export const TWIST_DEFS: TwistDefinition[] = [
  { id: "moneygun", aliases: ["mg", "moneygun"], requiresTarget: true },
  { id: "bomb", aliases: ["bomb"], requiresTarget: true },
  { id: "immune", aliases: ["imm", "immune"], requiresTarget: false },
  { id: "heal", aliases: ["he", "heal"], requiresTarget: true },
  { id: "galaxy", aliases: ["gal", "galaxy"], requiresTarget: false },
  { id: "diamondpistol", aliases: ["dp", "diamondpistol"], requiresTarget: true },
];

/* ============================================================================
   INVENTORY (server memory)
============================================================================ */

interface TwistInventory {
  [username: string]: {
    [twistId: string]: number;
  };
}

const inventory: TwistInventory = {};

/* ============================================================================
   HELPERS
============================================================================ */

function findTwistType(input: string): string | null {
  const clean = input.toLowerCase();
  for (const t of TWIST_DEFS) {
    if (t.aliases.includes(clean) || t.id === clean) return t.id;
  }
  return null;
}

function getInventorySlot(username: string, twist: string): number {
  const u = username.toLowerCase();
  if (!inventory[u]) inventory[u] = {};
  return inventory[u][twist] || 0;
}

function addInventory(username: string, twist: string) {
  const u = username.toLowerCase();
  if (!inventory[u]) inventory[u] = {};
  inventory[u][twist] = (inventory[u][twist] || 0) + 1;
}

function consumeInventory(username: string, twist: string): boolean {
  const u = username.toLowerCase();
  if (!inventory[u] || !inventory[u][twist]) return false;

  inventory[u][twist]--;
  if (inventory[u][twist] <= 0) delete inventory[u][twist];
  return true;
}

/* ============================================================================
   TWIST APPLICATION HELPERS
============================================================================ */

function findArenaPlayer(username: string): ArenaPlayer | null {
  const arena = getArena();
  const clean = username.toLowerCase();
  return arena.players.find(
    (p) => p.username.toLowerCase() === clean
  ) || null;
}

/* ============================================================================
   APPLY LOGICA PER TWIST
============================================================================ */

function applyMoneyGun(target: ArenaPlayer): string {
  if (target.immuneTwist) return `❌ ${target.display_name} is immune (MG blocked)`;
  target.markedMG = true;
  return `🟠 MoneyGun → ${target.display_name}`;
}

function applyBomb(target: ArenaPlayer): string {
  if (target.immuneTwist) return `❌ ${target.display_name} is immune (Bomb blocked)`;
  target.markedBomb = true;
  return `💣 Bomb → ${target.display_name}`;
}

function applyImmune(caster: ArenaPlayer): string {
  caster.immuneTwist = true;
  return `🛡 Immune twist → ${caster.display_name}`;
}

function applyHeal(target: ArenaPlayer): string {
  target.markedMG = false;
  target.markedBomb = false;
  // DP mag niet geheald worden
  return `💚 Heal → ${target.display_name}`;
}

function applyGalaxy(): string {
  const arena = getArena();
  arena.galaxyReversed = !arena.galaxyReversed;
  return `🌌 Galaxy twist → Scores reversed`;
}

function applyDiamondPistol(caster: ArenaPlayer, target: ArenaPlayer): string {
  const arena = getArena();

  if (arena.dpUsedThisRound) return `❌ DiamondPistol kan maar 1× per ronde`;

  target.dpSurvivor = true;
  arena.dpUsedThisRound = true;
  return `🔫 DiamondPistol → ${target.display_name} wordt DP-survivor`;
}

/* ============================================================================
   EXECUTION ROUTER
============================================================================ */

function executeTwist(
  caster: ArenaPlayer,
  twist: string,
  target?: ArenaPlayer
): string {

  switch (twist) {
    case "moneygun":
      if (!target) return "❌ MoneyGun vereist een target";
      return applyMoneyGun(target);

    case "bomb":
      if (!target) return "❌ Bomb vereist een target";
      return applyBomb(target);

    case "immune":
      return applyImmune(caster);

    case "heal":
      if (!target) return "❌ Heal vereist een target";
      return applyHeal(target);

    case "galaxy":
      return applyGalaxy();

    case "diamondpistol":
      if (!target) return "❌ DiamondPistol vereist een target";
      return applyDiamondPistol(caster, target);

    default:
      return "❌ Ongeldige twist";
  }
}

/* ============================================================================
   MAIN PUBLIC API — useTwist
   ---------------------------------------------------------------------------
   Wordt gebruikt door:
   ✔ Chat-engine (!use)
   ✔ Admin dashboard (useTwist)
============================================================================ */

export async function useTwist(
  casterUsername: string,
  twistInput: string,
  targetUsername?: string,
  adminForce: boolean = false
): Promise<{ success: boolean; message: string }> {
  const twist = findTwistType(twistInput);
  if (!twist) return { success: false, message: "❌ Onbekende twist alias" };

  const arena = getArena();

  // caster
  const caster = findArenaPlayer(casterUsername);
  if (!caster) return { success: false, message: "❌ Caster zit niet in arena" };

  // target (indien nodig)
  let target: ArenaPlayer | undefined = undefined;

  const def = TWIST_DEFS.find((t) => t.id === twist)!;
  if (def.requiresTarget) {
    if (!targetUsername)
      return { success: false, message: `❌ ${twist} vereist een target` };

    target = findArenaPlayer(targetUsername);
    if (!target)
      return { success: false, message: "❌ Target zit niet in arena" };
  }

  // Geen inventaris check bij adminForce
  if (!adminForce) {
    const slot = getInventorySlot(casterUsername, twist);
    if (slot <= 0) {
      return { success: false, message: `❌ Je hebt geen ${twist} twist` };
    }

    // consume
    if (!consumeInventory(casterUsername, twist)) {
      return { success: false, message: "❌ Inventarisfout" };
    }
  }

  // DP → één per ronde
  if (twist === "diamondpistol" && arena.dpUsedThisRound)
    return {
      success: false,
      message: "❌ DiamondPistol kan maar 1× per ronde gebruikt worden",
    };

  // EFFECT UITVOEREN
  const result = executeTwist(caster, twist, target);

  // LOG
  emitLog({
    type: "twist",
    message: result,
    meta: {
      caster: caster.username,
      twist,
      target: target?.username || null,
    },
  });

  // REALTIME INVENTORY UPDATE
  io.emit("twist:inventory:update", {
    username: caster.username,
    inventory: inventory[caster.username.toLowerCase()] || {},
  });

  return { success: true, message: result };
}

/* ============================================================================
   ADMIN USE TWIST
============================================================================ */

export async function adminUseTwist(
  username: string,
  twist: string,
  target?: string
) {
  return await useTwist(username, twist, target, true);
}

/* ============================================================================
   GIVE TWIST (gifts & admin)
   ---------------------------------------------------------------------------
   Called from:
   ✔ Gift-engine
   ✔ Admin dashboard (giveTwist)
============================================================================ */

export function giveTwist(username: string, twistInput: string) {
  const twist = findTwistType(twistInput);
  if (!twist) return;

  addInventory(username, twist);

  const slot = getInventorySlot(username, twist);

  emitLog({
    type: "twist",
    message: `🎁 ${username} ontving 1× ${twist} (nu ${slot})`,
  });

  io.emit("twist:inventory:update", {
    username,
    inventory: inventory[username.toLowerCase()] || {},
  });
}

/* ============================================================================
   GET INVENTORY (for admin)
============================================================================ */

export function getPlayerInventory(username: string) {
  return inventory[username.toLowerCase()] || {};
}

/* ============================================================================
   RESET INVENTORY (op arena reset)
============================================================================ */

export function resetTwistInventory() {
  for (const key of Object.keys(inventory)) delete inventory[key];
    }

/* ============================================================================
   UTILS
============================================================================ */

function findArenaPlayer(username: string): ArenaPlayer | undefined {
  const clean = username.replace(/^@+/, "").toLowerCase();
  return getArena().players.find(
    (p) =>
      p.username.toLowerCase() === clean ||
      p.display_name.toLowerCase() === clean
  );
}

function addInventory(username: string, twist: TwistType) {
  const u = username.toLowerCase();
  if (!inventory[u]) inventory[u] = {};
  if (!inventory[u][twist]) inventory[u][twist] = 0;
  inventory[u][twist]++;
}

function consumeInventory(username: string, twist: TwistType): boolean {
  const u = username.toLowerCase();
  if (!inventory[u] || !inventory[u][twist]) return false;
  inventory[u][twist]--;
  if (inventory[u][twist] <= 0) delete inventory[u][twist];
  return true;
}

function getInventorySlot(username: string, twist: TwistType): number {
  const u = username.toLowerCase();
  return inventory[u]?.[twist] || 0;
}

/* ============================================================================
   BOOSTER / STATUS HELPERS
============================================================================ */

function markElimination(player: ArenaPlayer) {
  player.eliminated = true;
  player.positionStatus = "elimination";
}

function applyHeal(player: ArenaPlayer) {
  // Heal verwijdert MG/Bomb eliminatie status
  if (player.eliminated) {
    player.eliminated = false;
    player.positionStatus = "alive";
  }
}

function applyImmune(player: ArenaPlayer) {
  if (!player.boosters.includes("immune")) {
    player.boosters.push("immune");
  }
}

/* ============================================================================
   CORE EFFECT LOGICA
   ---------------------------------------------------------------------------
   Hier gebeurt de magie van elke twist.
============================================================================ */

function executeTwist(
  caster: ArenaPlayer,
  twist: TwistType,
  target?: ArenaPlayer
): string {
  const arena = getArena();

  /* ----------------------------------------------------------
     GALAXY (TOGGLE RANKING)
  ---------------------------------------------------------- */
  if (twist === "galaxy") {
    arena.players.reverse();
    return `💫 Galaxy gebruikt — ranking omgedraaid!`;
  }

  /* ----------------------------------------------------------
     IMMUNE
  ---------------------------------------------------------- */
  if (twist === "immune") {
    if (!target) return "❌ Geen target";
    applyImmune(target);
    return `🛡 ${target.display_name} kreeg IMMUNE`;
  }

  /* ----------------------------------------------------------
     HEAL
  ---------------------------------------------------------- */
  if (twist === "heal") {
    if (!target) return "❌ Geen target";
    applyHeal(target);
    return `✨ ${target.display_name} werd gehealed`;
  }

  /* ----------------------------------------------------------
     MONEY GUN
     - Markeer target voor eliminatie
     - Immune blokkeert
  ---------------------------------------------------------- */
  if (twist === "moneygun") {
    if (!target) return "❌ Geen target";

    if (target.boosters.includes("immune"))
      return `🛡 ${target.display_name} had immune — MoneyGun geblokkeerd`;

    markElimination(target);
    return `💸 MoneyGun → ${target.display_name} gemarkeerd voor eliminatie`;
  }

  /* ----------------------------------------------------------
     BOMB (random)
     - zoekt random target zonder immune
  ---------------------------------------------------------- */
  if (twist === "bomb") {
    const arena = getArena();

    const candidates = arena.players.filter(
      (p) => !p.boosters.includes("immune")
    );

    if (candidates.length === 0)
      return "💣 Bomb vond geen geldige target (iedereen is immune)";

    const randomTarget =
      candidates[Math.floor(Math.random() * candidates.length)];

    markElimination(randomTarget);
    return `💥 Bomb trof ${randomTarget.display_name}`;
  }

  /* ----------------------------------------------------------
     DIAMOND PISTOL
     - 1 per ronde
     - Target wordt immune
     - Iedereen anders eliminated
     - Immune & Heal worden genegeerd
  ---------------------------------------------------------- */
  if (twist === "diamondpistol") {
    if (!target) return "❌ Geen target";

    arena.dpUsedThisRound = true;

    // Target = auto immune
    applyImmune(target);

    for (const p of arena.players) {
      if (p.id === target.id) continue;
      markElimination(p);
    }

    return `🔫💎 DiamondPistol → ${target.display_name} overleeft, alle anderen gemarkeerd!`;
  }

  return "❌ Twist heeft geen effect";
}

/* ============================================================================
   EXPORT
============================================================================ */

export default {
  useTwist,
  adminUseTwist,
  giveTwist,
  getPlayerInventory,
  resetTwistInventory,
};
