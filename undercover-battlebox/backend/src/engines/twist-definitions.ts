// ============================================================================
// twist-definitions.ts — v4.1.1 (Bomb Command Update: bom/bomb/💣)
// ----------------------------------------------------------------------------
// ✔ MoneyGun mark-model velden toegevoegd (markForRoundEnd, blockIfImmune, etc.)
// ✔ Bomb mark-model velden toegevoegd
// ✔ Heal kan MG/Bomb markeringen verwijderen
// ✔ DiamondPistol ongewijzigd gelaten
// ✔ Backwards compatible twist-engine v14+
// ✔ Bomb aliases geüpdatet naar: ["bom", "bomb", "💣"]
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "immune"
  | "heal"
  | "diamondpistol";

// ============================================================================
// DEFINITIE STRUCTUUR (met Fase-2 extra properties)
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
  // MONEY GUN
  // --------------------------------------------------------------------------
  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "mg", "gun"],
    description:
      "Markeert een gekozen speler voor eliminatie aan het einde van de ronde. Immune blokkeert, Heal verwijdert deze markering.",
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
  // BOMB — UPDATED ALIASES
  // --------------------------------------------------------------------------
  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bom", "bomb", "💣"], // <── UPDATE HIER
    description:
      "Bombardeert willekeurig een speler (immune wordt overgeslagen) en markeert voor eliminatie aan het einde van de ronde. Heal verwijdert deze markering.",
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
  // IMMUNE
  // --------------------------------------------------------------------------
  immune: {
    giftId: 14658,
    giftName: "Blooming Heart (Immune)",
    diamonds: 1599,
    aliases: ["immune", "immunity", "save", "protect"],
    description:
      "Geeft immuniteit tegen MoneyGun, Bomb en normale eliminaties. Niet tegen DiamondPistol.",
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
      "Verwijdert eliminatie-status veroorzaakt door MoneyGun of Bomb. Werkt niet tegen DiamondPistol.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,

    healEliminationMark: true,
    allowedDuring: "both",
  },

  // --------------------------------------------------------------------------
  // DIAMOND PISTOL
  // --------------------------------------------------------------------------
  diamondpistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    aliases: ["pistol", "dp", "diamondgun", "diamondpistol"],
    description:
      "Extreme twist: gekozen speler overleeft, wordt immune; alle anderen krijgen eliminate-status. Immune/Heal werken niet. Slechts één keer per ronde.",
    requiresTarget: true,
    targeted: true,
    isOffensive: true,

    instantEliminate: true,
    blockIfImmune: false,
    healEliminationMark: false,
    onePerRound: true,
    allowedDuring: "active",
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
