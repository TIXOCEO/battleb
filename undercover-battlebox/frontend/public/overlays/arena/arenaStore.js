// ============================================================================
// ARENA STORE — State manager for arena overlay
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

export const arenaStore = createStore({
  hud: {
    roundNumber: 1,
    roundType: "quarter",
    roundStatus: "idle",
    remainingMs: 30000,
    totalMs: 30000
  },
  players: [],
  takeoverEvent: null
});

// Update HUD
arenaStore.setHUD = (hud) => {
  arenaStore.set({ hud: { ...arenaStore.get().hud, ...hud } });
};

// Update players list
arenaStore.setPlayers = (players) => {
  arenaStore.set({ players });
};

// Trigger takeover (twist)
arenaStore.takeover = (title, description) => {
  arenaStore.set({ takeoverEvent: { title, description } });
};

arenaStore.clearTakeover = () => {
  arenaStore.set({ takeoverEvent: null });
};
