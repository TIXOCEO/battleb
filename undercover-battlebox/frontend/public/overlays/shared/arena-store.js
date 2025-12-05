/* ============================================================================
   arena-store.js — FINAL UPGRADED TIMER + PROGRESS VERSION (v6.1)
   Backwards-compatible with all older BattleBox engines
============================================================================ */

import { createStore } from "/overlays/shared/stores.js";

/* ============================================================================
   ARENA STORE — NEW TIMER MODEL (endsAt + totalMs)
   + Fully backwards compatible with old roundCutoff / graceEnd
============================================================================ */

export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",
  players: [],

  // PREEXISTING GLOBAL SETTINGS (fallback for old engine)
  settings: {
    roundDurationPre: 30,   // seconds
    roundDurationFinal: 300 // seconds
  },

  // NEW TIMER MODEL
  totalMs: 0,   // full duration of current phase in milliseconds
  endsAt: 0,    // absolute timestamp "when this phase ends"

  // OLD TIMER KEYS (kept for legacy fallback)
  roundCutoff: 0,
  graceEnd: 0,
});

/* ============================================================================
   HUD PROGRESS (NEW LOGIC)
   - Uses endsAt + totalMs when present
   - Falls back safely to roundCutoff / graceEnd for older backends
============================================================================ */

export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  let totalMs = state.totalMs;
  let remainingMs = Math.max(0, state.endsAt - now);

  /* -------------------------------------------------------
     FALLBACK MODE: OLD ENGINE (no totalMs provided)
  -------------------------------------------------------- */
  if (!totalMs || totalMs <= 0) {
    if (state.status === "active") {
      totalMs = state.settings.roundDurationPre * 1000;
      remainingMs = Math.max(0, state.roundCutoff - now);
    } else if (state.status === "finale") {
      totalMs = state.settings.roundDurationFinal * 1000;
      remainingMs = Math.max(0, state.roundCutoff - now);
    } else if (state.status === "grace") {
      totalMs = 5000;
      remainingMs = Math.max(0, state.graceEnd - now);
    }
  }

  /* -------------------------------------------------------
     SAFETY: prevent division by zero
  -------------------------------------------------------- */
  if (totalMs <= 0) totalMs = 1;

  const progress = 1 - (remainingMs / totalMs);
  const offset = circumference * progress;

  ringEl.style.strokeDashoffset = offset;
}

/* ============================================================================
   TWIST STORE (overlay-only)
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
