// ============================================================================
// twist-definitions.ts — Twist Configurations v1.0
// ============================================================================
//
// Dit bestand definieert ALLE twists:
//  - giftId: gebruikt voor detectie in gift-engine
//  - giftName: naam zoals TikTok hem doorgeeft
//  - diamonds: diamantwaarde van de gift
//  - requiresTarget: sommige twists hebben een doelwit nodig
//  - chatAliases: alle varianten die chat kan gebruiken (!use moneygun, !use mg)
//
// ============================================================================

export type TwistType =
  | "galaxy"
  | "moneygun"
  | "immune"
  | "diamond_pistol"
  | "bomb"
  | "heal";

export interface TwistDefinition {
  giftId: number;
  giftName: string;
  diamonds: number;
  requiresTarget: boolean;
  chatAliases: string[];
}

/**
 * Hoofd mapping van alle twists.
 * Let op: giftId moet exact overeenkomen met TikTok gift-ID's.
 */
export const TWIST_MAP: Record<TwistType, TwistDefinition> = {
  galaxy: {
    giftId: 11046,
    giftName: "Galaxy",
    diamonds: 1000,
    requiresTarget: false,
    chatAliases: ["galaxy", "sterrenstelsel", "reverse", "flip"],
  },

  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    requiresTarget: true,
    chatAliases: ["moneygun", "mg", "gun"],
  },

  immune: {
    giftId: 14658,
    giftName: "Blooming Heart",
    diamonds: 1599,
    requiresTarget: true,
    chatAliases: ["immune", "immuun", "shield", "protect"],
  },

  diamond_pistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    requiresTarget: true,
    chatAliases: ["diamondpistol", "diamantpistool", "dp", "wipe"],
  },

  bomb: {
    giftId: 16101,
    giftName: "Space Dog",
    diamonds: 2500,
    requiresTarget: false,
    chatAliases: ["bomb", "bom", "boom"],
  },

  heal: {
    giftId: 14210,
    giftName: "Galaxy Globe",
    diamonds: 1500,
    requiresTarget: true,
    chatAliases: ["heal", "revive", "hp", "reanimate"],
  },
};

/**
 * Vind twisttype op basis van gift-ID.
 */
export function findTwistByGiftId(giftId: number): TwistType | null {
  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].giftId === giftId) return key;
  }
  return null;
}

/**
 * Vind twisttype op basis van chatwoord.
 * Hiermee werken alle varianten van !use commands:
 *  !use mg @user
 *  !use shield @user
 *  !use diamantpistool @user
 */
export function findTwistByAlias(alias: string): TwistType | null {
  const clean = alias.toLowerCase().trim();

  for (const key of Object.keys(TWIST_MAP) as TwistType[]) {
    if (TWIST_MAP[key].chatAliases.includes(clean)) {
      return key;
    }
  }

  return null;
}
