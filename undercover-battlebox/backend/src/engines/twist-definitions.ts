// ============================================================================
// twist-definitions.ts — v3.3 (Danny + GPT Final Build)
// ============================================================================
//
// FINAL RULES:
// - Galaxy toggles ranking
// - MoneyGun: targeted → end-round eliminate (immune blocks, heal removes)
// - Bomb: random → end-round eliminate (immune blocks, heal removes)
// - Immune: protects vs MG/Bomb/normal elim, NOT vs DP
// - Heal: removes MG/Bomb eliminate status only
// - DiamondPistol: target is auto-immune, everyone else = eliminate status,
//   bypasses immune & heal, only once per round
//
// Shield is removed entirely.
//
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
// TWIST MAP — FINAL DEFINITIONS
// ============================================================================
export const TWIST_MAP: Record<TwistType, TwistDefinition> = {

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

  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "gun"],
    description:
      "Markeert een gekozen speler voor eliminatie aan het einde van de ronde. Immune blokkeert, Heal verwijdert deze markering.",
    requiresTarget: true,
    targeted: true,
    isOffensive: true,
  },

  bomb: {
    giftId: 16101,
    giftName: "Space Dog (Bomb)",
    diamonds: 2500,
    aliases: ["bomb", "boom"],
    description:
      "Bombardeert een willekeurige speler (immune wordt overgeslagen) en markeert voor eliminatie aan het einde van de ronde. Heal kan deze markering verwijderen.",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  immune: {
    giftId: 14658,
    giftName: "Blooming Heart (Immune)",
    diamonds: 1599,
    aliases: ["immune", "immunity", "save"],
    description:
      "Geeft immuniteit tegen MoneyGun, Bomb en normale eliminaties. Werkt niet tegen DiamondPistol.",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

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
  },

  diamondpistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    aliases: ["pistol", "dp", "diamondgun"],
    description:
      "Ultra agressieve twist: de gekozen target overleeft en wordt automatisch immune; alle andere spelers krijgen eliminate-status. Immune en Heal werken niet. Slechts één keer per ronde.",
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
