/* ============================================================================
   arena-store.js — FINAL PATCH
   Compatibel met jouw stores.js (createStore aanwezig)
   ============================================================================
*/

import { createStore } from "/overlays/shared/stores.js";

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

/* ============================================================================
   HUD PROGRESS
============================================================================ */

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
    remaining = Math.max(0, Math.floor((state.roundCutoff - now) / 1000));
  }

  if (state.status === "grace") {
    total = 5;
    remaining = Math.max(0, Math.floor((state.graceEnd - now) / 1000));
  }

  const progress = 1 - remaining / total;
  const offset = circumference * progress;

  ringEl.style.strokeDashoffset = offset;
}

/* ============================================================================
   TWISTS STORE (Overlay-only twist state)
============================================================================ */

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

/* ============================================================================
   EXPORT
============================================================================ */
export default {
  arenaStore,
  arenaTwistStore,
  renderHudProgress,
};
