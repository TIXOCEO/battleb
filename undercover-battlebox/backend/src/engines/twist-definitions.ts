// ============================================================================
// twist-definitions.ts — v1.0
// Centrale registry voor alle TWISTS / BOOSTERS / EFFECTEN
// Gelezen door twist-engine + admin-twist-engine
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "bomb"
  | "shield"
  | "immune"
  | "eliminate1"
  | "revive"
  | "fanboost"
  | "vipboost"
  | "queuejump"
  | "diamondpistol";

// ============================================================================
// TWIST DEFINITIONS
// ============================================================================

export interface TwistDefinition {
  giftId: number | null;         // gift koppeling (optioneel)
  giftName: string;              // herkenbare naam
  diamonds: number;              // waarde (voor logs / leaderboards)
  aliases: string[];             // tekst triggers
  description: string;           // admin UI en debugging
  requiresTarget: boolean;       // moet admin of engine een user kiezen?
  targeted: boolean;             // twist werkt OP iemand (niet AoE)
  isOffensive: boolean;          // veroorzaakt schade/elimination?
}

// ============================================================================
// DE CENTRALE TWIST MAP
// Niets hier aanpassen tenzij je nieuwe twists toevoegt
// ============================================================================

export const TWIST_MAP: Record<TwistType, TwistDefinition> = {
  galaxy: {
    giftId: 5650,
    giftName: "Galaxy",
    diamonds: 1000,
    aliases: ["galaxy", "gxy"],
    description: "Galaxy — keert de ranglijst om",
    requiresTarget: false,
    targeted: false,
    isOffensive: false,
  },

  moneygun: {
    giftId: 5499,
    giftName: "Money Gun",
    diamonds: 500,
    aliases: ["moneygun", "gun"],
    description: "MoneyGun — elimineert 1 speler aan het einde van de ronde",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  bomb: {
    giftId: 7781,
    giftName: "Bomb",
    diamonds: 800,
    aliases: ["bomb", "boom"],
    description: "Bomb — AoE damage op onderste posities",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },

  shield: {
    giftId: 9921,
    giftName: "Shield",
    diamonds: 500,
    aliases: ["shield", "protect"],
    description: "Shield — beschermt tegen 1 aanval",
    requiresTarget: false,
    targeted: false,
    isOffensive: false,
  },

  immune: {
    giftId: 6601,
    giftName: "Immune Boost",
    diamonds: 700,
    aliases: ["immune", "immunity"],
    description: "Immune — speler is immuun voor eliminaties",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  eliminate1: {
    giftId: null,
    giftName: "Admin Eliminate 1",
    diamonds: 0,
    aliases: ["elim1"],
    description: "Admin-mode eliminate (1 speler)",
    requiresTarget: true,
    targeted: true,
    isOffensive: true,
  },

  revive: {
    giftId: null,
    giftName: "Revive",
    diamonds: 0,
    aliases: ["revive", "rez"],
    description: "Brengt een speler terug in de queue",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  fanboost: {
    giftId: null,
    giftName: "Fan Booster",
    diamonds: 0,
    aliases: ["fanboost"],
    description: "Geeft fan-move omhoog",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  vipboost: {
    giftId: null,
    giftName: "VIP Booster",
    diamonds: 0,
    aliases: ["vipboost"],
    description: "Geeft VIP push omhoog",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  queuejump: {
    giftId: null,
    giftName: "Queue Jump",
    diamonds: 0,
    aliases: ["jump", "qjump"],
    description: "Springt direct naar voren in de queue",
    requiresTarget: true,
    targeted: true,
    isOffensive: false,
  },

  diamondpistol: {
    giftId: 999001,
    giftName: "Diamond Pistol",
    diamonds: 5000,
    aliases: ["pistol", "dp"],
    description: "Schiet 7 spelers dood (twist-engine doet dit zelf)",
    requiresTarget: false,
    targeted: false,
    isOffensive: true,
  },
};

// ============================================================================
// HELPER — find twist by alias
// ============================================================================

export function resolveTwistAlias(input: string): TwistType | null {
  const lower = input.toLowerCase();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].aliases.includes(lower)) return key;
  }

  return null;
}
