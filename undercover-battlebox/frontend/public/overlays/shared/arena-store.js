// ============================================================================
// arena-store.js — Shared Arena Store (OBS Overlays)
// Standalone store (geen React, geen Zustand)
// ============================================================================

export const arenaStore = {
  state: {
    hud: {
      roundNumber: 0,
      roundType: "quarter",
      roundStatus: "idle",
      remainingMs: 0,
      totalMs: 0,
    },

    players: Array.from({ length: 8 }, () => ({
      id: null,
      display_name: "",
      username: "",
      avatar_url: null,
      score: 0,
      positionStatus: "alive",
      breakerHits: 0,
    })),

    lastUpdateAt: 0,
  },

  subscribers: new Set(),

  // -----------------------------------------------------
  // Subscribe to changes
  // -----------------------------------------------------
  subscribe(fn) {
    this.subscribers.add(fn);
    fn(this.state); // immediately call with current state

    return () => {
      this.subscribers.delete(fn);
    };
  },

  // -----------------------------------------------------
  // Set HUD section
  // -----------------------------------------------------
  setHUD(hud) {
    this.state.hud = { ...this.state.hud, ...hud };
    this.state.lastUpdateAt = Date.now();
    this.emit();
  },

  // -----------------------------------------------------
  // Replace full players array (8 spots)
  // -----------------------------------------------------
  setPlayers(playersArray) {
    const filled = [...playersArray];

    while (filled.length < 8) {
      filled.push({
        id: null,
        display_name: "",
        username: "",
        avatar_url: null,
        score: 0,
        positionStatus: "empty",
        breakerHits: 0,
      });
    }

    this.state.players = filled.slice(0, 8);
    this.state.lastUpdateAt = Date.now();
    this.emit();
  },

  // -----------------------------------------------------
  // Emit update to all subscribers
  // -----------------------------------------------------
  emit() {
    for (const fn of this.subscribers) fn(this.state);
  },
};
