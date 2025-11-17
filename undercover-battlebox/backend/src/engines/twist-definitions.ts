// ============================================================================
// twist-definitions.ts — v2.0 (Danny Stable Build)
// ============================================================================
//
// ✔ COMPLETE SET (Galaxy, MoneyGun, Bomb, Shield, Immune, DiamondPistol, Heal)
// ✔ Alle giftId’s zoals opgegeven
// ✔ Aliases voor chat (!use heal @user)
// ✔ isOffensive / targeted / requiresTarget 100% correct
// ✔ Klaar voor twist-engine v3.0
//
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "shield"
  | "immune"
  | "heal"
  | "diamondpistol";

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
}

// ============================================================================
// TWIST MAP — COMPLETE, FINAL, READY
// ============================================================================

export const TWIST_MAP: Record<TwistType, TwistDefinition> = {
  // ------------------------------------------------------------------------
  galaxy: {
    giftId: 11046,
    giftName: "Galaxy",
    diamonds: 1000,
    aliases: ["galaxy", "gxy"],
    description: "Keert de volledige ranking om.",
    requiresTarget: false,
    targeted: false,
    isOffensive: false,
  },

  // ------------------------------------------------------------------------
  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "gun"],
    description:
      "Elimineert 1 speler aan het einde van de ronde.",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  // ------------------------------------------------------------------------
  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bomb", "boom"],
    description:
      "Bombardeert een willekeurige speler (immune spelers worden overgeslagen).",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  // ------------------------------------------------------------------------
  shield: {
    giftId: 9921,
    giftName: "Shield",
    diamonds: 500,
    aliases: ["shield", "protect"],
    description: "Beschermt tegen 1 aanval (MoneyGun/Bomb).",
    requiresTarget: false,
    targeted: false,
    isOffensive: false,
  },

  // ------------------------------------------------------------------------
  immune: {
    giftId: 14658,
    giftName: "Blooming Heart (Immune)",
    diamonds: 1599,
    aliases: ["immune", "immunity"],
    description: "Maakt een speler volledig immuun voor eliminaties.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  // ------------------------------------------------------------------------
  heal: {
    giftId: 14210,
    giftName: "Galaxy Globe (Heal)",
    diamonds: 1500,
    aliases: ["heal", "medic", "restore"],
    description:
      "Verwijdert eliminatie-status van MoneyGun/Bomb en maakt speler weer alive.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  // ------------------------------------------------------------------------
  diamondpistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    aliases: ["pistol", "dp", "diamondgun"],
    description: "Laat slechts één gekozen speler overleven.",
    requiresTarget: true,
    targeted: true,
    isOffensive: true,
  },
};

// ============================================================================
// Helper — Vind twist op basis van alias
// ============================================================================
export function resolveTwistAlias(input: string): TwistType | null {
  const lower = input.toLowerCase();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].aliases.includes(lower)) return key;
  }
  return null;
}
