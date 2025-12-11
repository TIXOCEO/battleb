// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (v9.1 DUPLICATE-PROOF EDITION)
// FULL TWIST QUEUE REWRITE — 100% ORDER GUARANTEED + HARD RESET SYSTEM
// + NEW: Duplicate protection + processing lock
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
// TWIST STORE — v9.1 (ULTRA-STABLE + NO DUPLICATES)
// ============================================================================
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  step: null,
  payload: null,
  queue: [],

  lock: false,
  processing: false, // NEW: internal twist guard
});

// ============================================================================
// NEW — Duplicate twist prevention
// ============================================================================
let lastArenaTwistHash = null;

// ============================================================================
// HARD RESET — NEVER allow lingering Galaxy / stuck queue
// ============================================================================
arenaTwistStore.resetAll = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
    step: null,
    payload: null,
    queue: [],
    lock: false,
    processing: false,
  });

  lastArenaTwistHash = null; // wipe duplicate memory

  // SAFETY: Clear FX engine + galaxy chaos if available
  try {
    if (window.FX && window.FX.clear) window.FX.clear();
  } catch (e) {}

  try {
    if (window.disableGalaxyChaos) {
      const refs = window.cardRefs || [];
      window.disableGalaxyChaos(refs);
    }
  } catch (e) {}

  console.log("%c[TWIST] Hard reset executed", "color:#ff4f4f");
};

// ============================================================================
// INTERNAL — PROCESS NEXT QUEUED TWIST
// ============================================================================
function processNextTwist() {
  const st = arenaTwistStore.get();

  if (st.processing) return;
  if (st.lock) return;
  if (st.active) return;
  if (!st.queue.length) return;

  arenaTwistStore.set({ processing: true });

  const next = st.queue[0];
  arenaTwistStore.set({ lock: true });

  // start twist
  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    step: next.step ?? null,
    payload: next.payload,
  });

  // remove from queue
  arenaTwistStore.set({
    queue: st.queue.slice(1),
    lock: false,
    processing: false,
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
// PUBLIC API — ACTIVATE
// ============================================================================
arenaTwistStore.activate = (payload) => {
  if (!payload) return;

  // NEW: Duplicate twist hash blocker
  const hash = `${payload.type}|${payload.title}|${Math.floor(Date.now() / 900)}`;
  if (hash === lastArenaTwistHash) {
    console.warn("[ARENA TWIST] Duplicate activate blocked:", hash);
    return;
  }
  lastArenaTwistHash = hash;

  enqueue({
    type: payload.type ?? null,
    title: payload.title ?? "",
    step: payload.step ?? null,
    payload,
  });
};

// ============================================================================
// PUBLIC API — COUNTDOWN
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
// CLEAR — END CURRENT & PROCESS NEXT
// ============================================================================
arenaTwistStore.clear = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
    step: null,
    payload: null,
  });

  processNextTwist();
};

// ============================================================================
// OPTIONAL — FORCE FLUSH (Admin/Debug)
// ============================================================================
arenaTwistStore.forceFlush = () => {
  arenaTwistStore.resetAll();
  console.log("%c[TWIST] Force-flush executed (manual)", "color:#ff9f00");
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
