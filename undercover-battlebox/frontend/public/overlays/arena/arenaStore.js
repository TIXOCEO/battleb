// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (v9.0 NO-RACE QUEUE EDITION)
// FULL TWIST QUEUE REWRITE — 100% ORDER GUARANTEED
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ============================================================================
// ARENA STATE (HUD-MODEL v3 — stabiel)
// ============================================================================
export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",

  players: [],

  totalMs: 0,
  endsAt: 0,
  remainingMs: 0,

  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  roundCutoff: 0,
  graceEnd: 0,
});

// ============================================================================
// SNAPSHOT HANDLING
// ============================================================================
export function setArenaSnapshot(snap) {
  if (!snap) return;
  const now = Date.now();

  const hud = snap.hud ?? snap;
  const totalMs = hud.totalMs ?? 0;
  const remainingMs = hud.remainingMs ?? Math.max(0, (hud.endsAt ?? 0) - now);

  arenaStore.set({
    round: hud.round ?? 0,
    type: hud.type ?? "quarter",
    status: hud.status ?? "idle",

    players: snap.players ?? [],

    settings: snap.settings || arenaStore.get().settings,

    totalMs,
    endsAt: hud.endsAt ?? now + totalMs,
    remainingMs,
    roundCutoff: snap.roundCutoff ?? 0,
    graceEnd: snap.graceEnd ?? 0,
  });
}

export function updatePlayers(players) {
  arenaStore.set({ players });
}

// ============================================================================
// HUD RING RENDER
// ============================================================================
export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  let total = (state.totalMs || 0) / 1000;
  let remaining = (state.remainingMs || 0) / 1000;

  if (!remaining || remaining <= 0) {
    remaining = Math.max(0, (state.endsAt - now) / 1000);
  }

  if (!total || total <= 0) {
    if (state.status === "active") {
      total = state.settings.roundDurationPre;
      remaining = Math.max(0, (state.roundCutoff - now) / 1000);
    } else if (state.status === "grace") {
      total = 5;
      remaining = Math.max(0, (state.graceEnd - now) / 1000);
    }
  }

  const progress = total > 0 ? 1 - remaining / total : 0;
  ringEl.style.strokeDashoffset = circumference * progress;
}

// ============================================================================
// TWIST STORE — v9.0 (ULTRA-STABLE QUEUE ENGINE)
// ============================================================================

export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  step: null,
  payload: null,
  queue: [],

  // internal lock to prevent race conditions
  lock: false,
});

// ============================================================================
// INTERNAL — PROCESS NEXT QUEUED TWIST
// ============================================================================
function processNextTwist() {
  const st = arenaTwistStore.get();

  if (st.lock) return;               // still processing
  if (st.active) return;             // still playing
  if (!st.queue.length) return;      // nothing to do

  const next = st.queue[0];          // do NOT shift yet (atomic)
  arenaTwistStore.set({ lock: true });

  // Start twist
  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    step: next.step ?? null,
    payload: next.payload,
  });

  // Now remove from queue
  arenaTwistStore.set({
    queue: st.queue.slice(1),
    lock: false,
  });
}

// ============================================================================
// PUBLIC — ADD A TWIST TO QUEUE
// ============================================================================
function enqueue(entry) {
  const st = arenaTwistStore.get();
  const nextQueue = [...st.queue, entry];

  arenaTwistStore.set({ queue: nextQueue });
  processNextTwist();
}

// ============================================================================
// PUBLIC API — ACTIVATE (always queued, never direct)
// ============================================================================
arenaTwistStore.activate = (payload) => {
  if (!payload) return;

  enqueue({
    type: payload.type ?? null,
    title: payload.title ?? "",
    step: payload.step ?? null,
    payload,
  });
};

// ============================================================================
// PUBLIC API — COUNTDOWN (queued like normal twist)
// ============================================================================
arenaTwistStore.countdown = (payload) => {
  if (!payload) return;

  enqueue({
    type: "countdown",
    title: "",
    step: payload.step ?? 3,
    payload,
  });
};

// ============================================================================
// CLEAR — END CURRENT & PROCESS NEXT IMMEDIATELY
// ============================================================================
arenaTwistStore.clear = () => {
  // clear active twist
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
    step: null,
    payload: null,
  });

  // run next twist synchronously
  processNextTwist();
};

// ============================================================================
// EXPORT
// ============================================================================
export default {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot,
  updatePlayers,
  renderHudProgress,
};
