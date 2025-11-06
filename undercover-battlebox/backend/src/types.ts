// backend/src/types.ts
export type User = {
  id: string;
  username: string;
  tiktok_id: string;
  bp_daily: number;
  bp_total: number;
  streak: number;
  queue_position?: number;
  priority: number;
  badges: ('vip' | 'fanclub' | 'superfan')[];
  blocks: {
    queue: boolean;
    twists: boolean;
    boosters: boolean;
  };
};

export type GameEvent =
  | { type: 'gift'; user: string; gift: string; diamonds: number; toHost: boolean }
  | { type: 'chat'; user: string; message: string }
  | { type: 'join'; user: string }
  | { type: 'follow'; user: string }
  | { type: 'share'; user: string };
