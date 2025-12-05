/* ============================================================================
   arena-store.js — FINAL UPGRADED TIMER + PROGRESS VERSION
   Backwards-compatible (roundCutoff/graceEnd preserved)
   ============================================================================
*/

import { createStore } from "/overlays/shared/stores.js";

/* ============================================================================
   ARENA STORE — NEW TIMER STRUCTURE
   ============================================================================
   New:
     totalMs → totale duur van huidige fase
     endsAt  → timestamp (ms) wanneer timer eindigt

   Old keys kept:
     roundCutoff, graceEnd  → blijven bestaan voor safety fallback
============================================================================ */

export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",
  players: [],

  // global settings for fallback
  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  // NEW timer model
  totalMs: 0,
  endsAt: 0,

  // OLD model kept for backwards safety
  roundCutoff: 0,
  graceEnd: 0,
});

/* ============================================================================
   HUD PROGRESS — NEW VERSION
   ============================================================================
   Uses:
     state.endsAt  → timestamp in ms
     state.totalMs → full duration in ms
============================================================================ */

export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;

  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  // Fallback: if endsAt not available, fallback to old system
  let totalMs = state.totalMs;
  let remainingMs = Math.max(0, state.endsAt - now);

  if (!state.totalMs || state.totalMs <= 0) {
    // OLD METHOD — keep as fallback
    if (state.status === "active") {
      totalMs = state.settings.roundDurationPre * 1000;
      remainingMs = Math.max(0, state.roundCutoff - now);
    } else if (state.status === "grace") {
      totalMs = 5000;
      remainingMs = Math.max(0, state.graceEnd - now);
    }
  }

  const progress = 1 - (remainingMs / totalMs);
  const offset = circumference * progress;

  ringEl.style.strokeDashoffset = offset;
}

/* ============================================================================
   TWISTS STORE — unchanged logic
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
