// ============================================================================
// twist-definitions.ts — Twist Type Definitions v1.0
// ============================================================================
//
// Bevat:
//  - TwistType enum
//  - Definitie van alle twists
//  - Aliases (!use moneygun, !use mg, !use gun, etc.)
//  - Zoekfunctie findTwistByAlias()
//  - Metadata nodig voor engines + admin tools
//
// ============================================================================


// Alle twist types — core identifiers
export type TwistType =
  | "reverse_rank"
  | "money_gun"
  | "immune"
  | "diamond_pistol"
  | "bomb"
  | "heal";

// ---------------------------------------------
// ALLE TWISTS MET COMPLETE METADATA
// ---------------------------------------------

export const TWIST_MAP: Record<
  TwistType,
  {
    giftId: number;
    giftName: string;
    diamonds: number;
    aliases: string[];
    description: string;
    targeted: boolean;        // moet er een @username doel zijn?
    isOffensive: boolean;     // valt een speler direct aan?
  }
> = {
  reverse_rank: {
    giftId: 11046,
    giftName: "Galaxy",
    diamonds: 1000,
    aliases: ["galaxy", "reverse", "rr", "flip", "sterrenstelsel"],
    description: "Draait de arena-ranglijst om op basis van diamonds.",
    targeted: false,
    isOffensive: false,
  },

  money_gun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "mg", "gun", "elimineer"],
    description: "Schiet een speler af — markeert als eliminated voor einde ronde.",
    targeted: true,
    isOffensive: true,
  },

  immune: {
    giftId: 14658,
    giftName: "Blooming Heart",
    diamonds: 1599,
    aliases: ["heart", "immune", "shield", "protect", "immu", "immuun"],
    description: "Geeft een speler immuniteit voor eliminatie.",
    targeted: true,
    isOffensive: false,
  },

  diamond_pistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    aliases: ["diamondpistol", "dp", "wipe", "diamantpistool"],
    description: "Wiped ALLE spelers behalve het doelwit — einde ronde eliminatie.",
    targeted: true,
    isOffensive: true,
  },

  bomb: {
    giftId: 16101,
    giftName: "Space Dog",
    diamonds: 2500,
    aliases: ["bomb", "dog", "explode", "bd", "bom"],
    description: "Selecteert 1 willekeurige speler om te elimineren.",
    targeted: false,
    isOffensive: true,
  },

  heal: {
    giftId: 14210,
    giftName: "Galaxy Globe",
    diamonds: 1500,
    aliases: ["heal", "globe", "hg", "reanimate", "herstel"],
    description: "Verwijdert 1 eliminatie-status van een speler.",
    targeted: true,
    isOffensive: false,
  },
};


// ============================================================================
// Zoekfunctie voor commando’s (!use moneygun @test)
// ============================================================================

export function findTwistByAlias(aliasRaw: string): TwistType | null {
  const alias = aliasRaw.trim().toLowerCase();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    const t = TWIST_MAP[key];
    if (t.aliases.includes(alias)) return key;
  }

  return null;
}
