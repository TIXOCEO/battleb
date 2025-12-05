// ============================================================================
// arena-store.js — BattleBox Arena Overlay Store (FINAL v5.0)
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ARENA STATE
export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",

  players: [],

  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  roundCutoff: 0,
  graceEnd: 0,
});

// Full snapshot
export function setArenaSnapshot(snap) {
  if (!snap) return;

  arenaStore.set({
    round: snap.round,
    type: snap.type,
    status: snap.status,
    players: snap.players,
    settings: snap.settings || arenaStore.get().settings,
    roundCutoff: snap.roundCutoff,
    graceEnd: snap.graceEnd,
  });
}

// Only players change
export function updatePlayers(players) {
  arenaStore.set({ players });
}

// HUD Ring
export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();
  let total = 1;
  let remaining = 0;

  if (state.status === "active") {
    total = state.settings.roundDurationPre;
    remaining = Math.max(0, ((state.roundCutoff - now) / 1000) | 0);
  }

  if (state.status === "grace") {
    total = 5;
    remaining = Math.max(0, ((state.graceEnd - now) / 1000) | 0);
  }

  const progress = 1 - remaining / total;
  ringEl.style.strokeDashoffset = circumference * progress;
}

// Twist takeover
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
});

arenaTwistStore.activate = (type, title) => {
  arenaTwistStore.set({ active: true, type, title });
};

arenaTwistStore.clear = () => {
  arenaTwistStore.set({ active: false, type: null, title: "" });
};

export default {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot,
  updatePlayers,
  renderHudProgress,
};
