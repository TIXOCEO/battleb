// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (HUD-COMPAT v6.1)
// ============================================================================
//
// ✔ Ondersteunt nieuw HUD-model van server v16.8:
//      totalMs, endsAt, remainingMs
// ✔ Backwards compatible met oude roundCutoff/graceEnd
// ✔ renderHudProgress werkt nu met het HUD-model
//
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ARENA STATE
export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",

  players: [],

  // NEW HUD MODEL
  totalMs: 0,
  endsAt: 0,
  remainingMs: 0,

  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  // old fallback
  roundCutoff: 0,
  graceEnd: 0,
});

// ============================================================================
// SNAPSHOT SETTER — supports HUD and old fields
// ============================================================================
export function setArenaSnapshot(snap) {
  if (!snap) return;

  const hud = snap.hud ?? snap;

  arenaStore.set({
    round: snap.round,
    type: snap.type,
    status: snap.status,

    players: snap.players,

    settings: snap.settings || arenaStore.get().settings,

    // NEW HUD KEYS
    totalMs: hud.totalMs ?? 0,
    endsAt: hud.endsAt ?? 0,
    remainingMs: hud.remainingMs ?? 0,

    // old compatibility
    roundCutoff: snap.roundCutoff ?? 0,
    graceEnd: snap.graceEnd ?? 0,
  });
}

// ============================================================================
// Only players change
// ============================================================================
export function updatePlayers(players) {
  arenaStore.set({ players });
}

// ============================================================================
// HUD RING — now uses new HUD model
// ============================================================================
export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  // NEW HUD MODEL
  let total = (state.totalMs || 0) / 1000;
  let remaining = Math.max(0, (state.endsAt - now) / 1000);

  // FALLBACK voor oude engines
  if (!total || total <= 0) {
    if (state.status === "active") {
      total = state.settings.roundDurationPre;
      remaining = Math.max(0, (state.roundCutoff - now) / 1000);
    }

    if (state.status === "grace") {
      total = 5;
      remaining = Math.max(0, (state.graceEnd - now) / 1000);
    }
  }

  const progress = total > 0 ? 1 - remaining / total : 0;
  ringEl.style.strokeDashoffset = circumference * progress;
}

// ============================================================================
// TWIST STORE
// ============================================================================
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
});

arenaTwistStore.activate = (payload) => {
  // supports both (type,title) and backend payload {type,title}
  const type = typeof payload === "string" ? payload : payload.type;
  const title = typeof payload === "string" ? "" : payload.title ?? "";
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
