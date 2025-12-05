"use client";

import { create } from "zustand";

interface ArenaPlayer {
  id: string;
  username: string;
  display_name: string;
  score: number;
  positionStatus: string;
  eliminated?: boolean;
  tempImmune?: boolean;
  survivorImmune?: boolean;
  breakerHits?: number;
}

interface ArenaState {
  players: ArenaPlayer[];
  round: number;
  type: string;
  status: string;
  reverseMode: boolean;
  diamondPistolUsed: boolean;

  roundStartTime: number;
  roundCutoff: number;
  graceEnd: number;

  settings: {
    roundDurationPre: number;
    roundDurationFinal: number;
    graceSeconds: number;
  };

  // HUD STATE
  hud: {
    elapsed: number;
    remaining: number;
    progress: number; 
  };

  // TWIST ANIMATION STATE
  twistEvent: {
    active: boolean;
    type: string | null;
    target?: string | null;
    timestamp: number;
  };

  // ACTIONS
  updateArena: (payload: any) => void;
  triggerTwistEvent: (type: string, target?: string) => void;
}

export const useArenaStore = create<ArenaState>((set, get) => ({
  players: [],
  round: 0,
  type: "quarter",
  status: "idle",
  reverseMode: false,
  diamondPistolUsed: false,

  roundStartTime: 0,
  roundCutoff: 0,
  graceEnd: 0,

  settings: {
    roundDurationPre: 0,
    roundDurationFinal: 0,
    graceSeconds: 0,
  },

  hud: {
    elapsed: 0,
    remaining: 0,
    progress: 0,
  },

  twistEvent: {
    active: false,
    type: null,
    timestamp: 0,
  },

  updateArena: (payload) => {
    const now = Date.now();

    // HUD calculation
    const duration =
      payload.type === "finale"
        ? payload.settings.roundDurationFinal
        : payload.settings.roundDurationPre;

    const elapsed = Math.max(0, Math.min(duration, (now - payload.roundStartTime) / 1000));
    const remaining = duration - elapsed;

    const progress = Math.min(1, Math.max(0, elapsed / duration));

    set({
      ...payload,
      hud: {
        elapsed,
        remaining,
        progress,
      },
    });
  },

  triggerTwistEvent: (type, target) => {
    set({
      twistEvent: {
        active: true,
        type,
        target,
        timestamp: Date.now(),
      },
    });

    // Automatically hide after 2.5 seconds (or config)
    setTimeout(() => {
      set({
        twistEvent: {
          active: false,
          type: null,
          target: null,
          timestamp: 0,
        },
      });
    }, 2500);
  },
}));
