// ============================================================================
// twist-definitions.ts — v4.4 (DiamondPistol Mark-Only Patch + Breaker Support)
// ----------------------------------------------------------------------------
// ✔ MoneyGun mark-model velden
// ✔ Bomb mark-model velden
// ✔ Heal verwijdert MG/Bomb markeringen
// ✔ DiamondPistol → MARK ONLY (NIET direct elimineren)
// ✔ BREAKER twist volledig geïntegreerd
// ✔ 100% compatibel met twist-engine v15.2 + game-engine v16.4
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "immune"
  | "heal"
  | "diamondpistol"
  | "breaker";

// ============================================================================
// DEFINITIE STRUCTUUR
// ============================================================================

export interface TwistDefinition {
  giftId: number | null;
  giftName: string;
  diamonds: number;
  aliases: string[];
  description: string;

  requiresTarget: boolean;
  targeted: boolean;
  isOffensive: boolean;

  blockIfImmune?: boolean;
  markForRoundEnd?: boolean;
  healEliminationMark?: boolean;
  instantEliminate?: boolean;
  onePerRound?: boolean;

  allowedDuring?: "active" | "grace" | "both";
}

// ============================================================================
// TWIST DEFINITIONS — FINAL
// ============================================================================

export const TWIST_MAP: Record<TwistType, TwistDefinition> = {

  // --------------------------------------------------------------------------
  // GALAXY
  // --------------------------------------------------------------------------
  galaxy: {
    giftId: 11046,
    giftName: "Galaxy",
    diamonds: 1000,
    aliases: ["galaxy", "gxy"],
    description:
      "Keert de ranking om. Nogmaals gebruiken zet de ranking weer terug (toggle).",
    requiresTarget: false,
    targeted: false,
    isOffensive: false,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // MONEYGUN
  // --------------------------------------------------------------------------
  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "mg", "gun"],
    description:
      "Markeert een speler voor eliminatie aan het einde van de ronde. Immune blokkeert.",
    requiresTarget: true,
    targeted: true,
    isOffensive: true,

    blockIfImmune: true,
    markForRoundEnd: true,
    healEliminationMark: true,
    instantEliminate: false,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // BOMB
  // --------------------------------------------------------------------------
  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bom", "bomb", "💣"],
    description:
      "Bombardeert willekeurig een speler (immune wordt overgeslagen) en markeert voor eliminatie.",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,

    blockIfImmune: true,
    markForRoundEnd: true,
    healEliminationMark: true,
    instantEliminate: false,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // IMMUNE — DEFENSE
  // --------------------------------------------------------------------------
  immune: {
    giftId: 14658,
    giftName: "Blooming Heart (Immune)",
    diamonds: 1599,
    aliases: ["immune", "immunity", "save", "protect"],
    description:
      "Geeft immuniteit tegen MoneyGun, Bomb en danger eliminaties. Niet tegen DiamondPistol.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // HEAL
  // --------------------------------------------------------------------------
  heal: {
    giftId: 14210,
    giftName: "Galaxy Globe (Heal)",
    diamonds: 1500,
    aliases: ["heal", "medic", "restore"],
    description:
      "Verwijdert eliminatie-status veroorzaakt door MoneyGun of Bomb.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,

    healEliminationMark: true,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // DIAMOND PISTOL — MARK ONLY (BELANGRIJKE FIX)
  // --------------------------------------------------------------------------
  diamondpistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    aliases: ["pistol", "dp", "diamondgun", "diamondpistol"],
    description:
      "Gekozen speler overleeft, wordt immune; alle anderen worden gemarkeerd voor end-round eliminatie. Slechts één keer per ronde.",

    requiresTarget: true,
    targeted: true,
    isOffensive: true,

    // 🔥 CORE FIX:
    instantEliminate: false,   // <── NIET meer instant elimineren
    markForRoundEnd: true,     // <── markeren zoals MG/Bomb

    blockIfImmune: false,
    healEliminationMark: false,
    onePerRound: true,
    allowedDuring: "active",
  },

  // --------------------------------------------------------------------------
  // BREAKER
  // --------------------------------------------------------------------------
  breaker: {
    giftId: 5978,
    giftName: "Breaker",
    diamonds: 899,
    aliases: ["breaker", "break", "train"],
    description:
      "Breekt immuniteit in 2 stappen. 1× = cracked, 2× = immune weg.",

    requiresTarget: true,
    targeted: true,
    isOffensive: true,

    blockIfImmune: false,
    markForRoundEnd: false,
    healEliminationMark: false,
    instantEliminate: false,
    onePerRound: false,
    allowedDuring: "both",
  },
};

// ============================================================================
// Helper — alias resolver
// ============================================================================

export function resolveTwistAlias(input: string): TwistType | null {
  const lower = input.toLowerCase();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].aliases.includes(lower)) return key;
  }
  return null;
}
