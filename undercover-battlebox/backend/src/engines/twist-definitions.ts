// ============================================================================
// twist-definitions.ts — v3.4 (MoneyGun Fase-1 Compatible Build)
// ----------------------------------------------------------------------------
// ✔ MoneyGun: targeted → end-round eliminate (immune blocks, heal removes)
// ✔ Andere twists blijven gedefinieerd, maar worden Fase 1 niet gebruikt
// ✔ Volledig compatibel met twist-engine v14.3 (marking model)
// ✔ Correcte aliases + mapping voor chat-engine (!use ...)
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "immune"
  | "heal"
  | "diamondpistol";

// ============================================================================
// DEFINITIE STRUCTUUR
// ============================================================================

export interface TwistDefinition {
  /** Uniek gift ID (TikTok) — null = niet gekoppeld aan gift */
  giftId: number | null;

  /** Hoe de gift / twist heet in logs */
  giftName: string;

  /** Hoeveel diamonds TikTok aan deze gift koppelt (indien toepasbaar) */
  diamonds: number;

  /** Aliases voor !use chat command */
  aliases: string[];

  /** Uitleg voor admin UI / logs */
  description: string;

  /** Vereist een target (bv. @username) */
  requiresTarget: boolean;

  /** Is de twist gericht op een specifieke speler? */
  targeted: boolean;

  /** Is de twist offensief (aanval) of defensief (support)? */
  isOffensive: boolean;
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
  },

  // --------------------------------------------------------------------------
  // MONEYGUN — FASE 1 TWIST
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
  },

  // --------------------------------------------------------------------------
  // BOMB — FASE 2
  // --------------------------------------------------------------------------
  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bomb", "boom", "dog"],
    description:
      "Bombardeert willekeurig een speler (immune wordt overgeslagen) en markeert voor eliminatie aan het einde van de ronde. Heal verwijdert deze markering.",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  // --------------------------------------------------------------------------
  // IMMUNE — FASE 3
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
  },

  // --------------------------------------------------------------------------
  // HEAL — FASE 4
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
  },

  // --------------------------------------------------------------------------
  // DIAMOND PISTOL — FASE 5
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
  },
};

// ============================================================================
// Helper — vind twist op basis van alias
// ============================================================================

export function resolveTwistAlias(input: string): TwistType | null {
  const lower = input.toLowerCase();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].aliases.includes(lower)) return key;
  }

  return null;
}
