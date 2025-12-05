// ============================================================================
// arena-store.js — BattleBox Arena Overlay Store (FINAL v5.0)
// Compatible with:
//   • stores.js (createStore)
//   • arena.js v5 renderer
//   • twistAnim.js (galaxy, moneygun, heal, immune, bomb, diamond)
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ============================================================================
// ARENA STATE (single source of truth)
// ============================================================================
export const arenaStore = createStore({
  round: 0,              // 1,2,3,...
  type: "quarter",       // quarter | finale
  status: "idle",        // idle | active | grace | ended

  players: [],           // array van 8 spelers

  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  roundCutoff: 0,        // timestamp wanneer ronde eindigt
  graceEnd: 0,           // timestamp wanneer grace eindigt
});

// ============================================================================
// EXPORTED MUTATORS
// (server stuurt snapshots naar de overlay via event-router)
// ============================================================================

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

// Update alleen spelers (bij gift events, eliminaties, twist effects)
export function updatePlayers(players) {
  arenaStore.set({ players });
}

// ============================================================================
// HUD PROGRESS RING RENDERING
// ============================================================================
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
  const offset = circumference * progress;

  ringEl.style.strokeDashoffset = offset;
}

// ============================================================================
// TWIST STORE — Fullscreen takeover state
// ============================================================================
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
});

// Activate fullscreen twist animation
arenaTwistStore.activate = (type, title) => {
  arenaTwistStore.set({
    active: true,
    type,
    title,
  });
};

// Clear twist overlay
arenaTwistStore.clear = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
  });
};

// ============================================================================
// EXPORT DEFAULT
// ============================================================================
export default {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot,
  updatePlayers,
  renderHudProgress,
};
