export type TwistType =
  | "galaxy"
  | "moneygun"
  | "immune"
  | "diamond_pistol"
  | "bomb"
  | "heal";

export const TWIST_MAP: Record<TwistType, {
  giftId: number;
  giftName: string;
  diamonds: number;
  requiresTarget: boolean;
  chatAliases: string[];
}> = {
  galaxy: {
    giftId: 11046,
    giftName: "Galaxy",
    diamonds: 1000,
    requiresTarget: false,
    chatAliases: ["galaxy", "sterrenstelsel"],
  },

  moneygun: {
    giftId: 7168,
    giftName: "Money Gun",
    diamonds: 500,
    requiresTarget: true,
    chatAliases: ["moneygun", "mg"],
  },

  immune: {
    giftId: 14658,
    giftName: "Blooming Heart",
    diamonds: 1599,
    requiresTarget: true,
    chatAliases: ["immune", "immuun", "shield"],
  },

  diamond_pistol: {
    giftId: 14768,
    giftName: "Diamond Gun",
    diamonds: 5000,
    requiresTarget: true,
    chatAliases: ["diamondpistol", "diamantpistool", "dp"],
  },

  bomb: {
    giftId: 16101,
    giftName: "Space Dog",
    diamonds: 2500,
    requiresTarget: false,
    chatAliases: ["bomb", "bom"],
  },

  heal: {
    giftId: 14210,
    giftName: "Galaxy Globe",
    diamonds: 1500,
    requiresTarget: true,
    chatAliases: ["heal", "revive"],
  },
};
