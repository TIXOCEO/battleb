// ============================================================================
// twist-definitions.ts — v4.2 (Bomb+Heal Compatibility Build)
// ----------------------------------------------------------------------------
// ✔ MoneyGun mark-model velden (markForRoundEnd, blockIfImmune, etc.)
// ✔ Bomb mark-model velden
// ✔ Heal verwijdert MG/Bomb markeringen (healEliminationMark=true)
// ✔ DiamondPistol ongewijzigd (zoals gevraagd)
// ✔ Bomb aliases: ["bom", "bomb", "💣"]
// ✔ 100% compatibel met twist-engine v14+
// ✔ Geen extra logica toegevoegd buiten noodzakelijke patches
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "immune"
  | "heal"
  | "diamondpistol";

// ============================================================================
// DEFINITIE STRUCTUUR (Fase-2 eigenschappen)
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

  /** Wordt effect tegengehouden door immune? */
  blockIfImmune?: boolean;

  /** Markeer slachtoffer voor eliminatie aan einde van ronde */
  markForRoundEnd?: boolean;

  /** Heal kan deze markering verwijderen */
  healEliminationMark?: boolean;

  /** Directe eliminatie (DiamondPistol) */
  instantEliminate?: boolean;

  /** Slechts één keer per ronde toegestaan? */
  onePerRound?: boolean;

  /** Mag tijdens active/grace/beide? */
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
  // BOMB — ALIASES GEÜPDATET
  // --------------------------------------------------------------------------
  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bom", "bomb", "💣"], // <── JOUW CHATCOMMANDOS
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
  // IMMUNE — DEFENSE
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
  // HEAL — verwijdert MG/Bomb markeringen
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
  // DIAMOND PISTOL — ONGEWIJZIGD
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
