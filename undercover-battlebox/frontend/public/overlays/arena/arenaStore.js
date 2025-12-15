// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (v9.0 NO-RACE QUEUE EDITION)
// FULL TWIST QUEUE REWRITE — 100% ORDER GUARANTEED + HARD RESET SYSTEM
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
// SNAPSHOT HANDLING  (BACKEND IS LEIDEND)
// ============================================================================

export function setArenaSnapshot(snap) {
  if (!snap) return;

  const now = Date.now();
  const current = arenaStore.get();

  const hud = snap.hud ?? snap;

  // 🔒 Alleen overschrijven als backend waarden levert
  const hasTotal = typeof hud.totalMs === "number";
  const hasEndsAt = typeof hud.endsAt === "number";

  const totalMs = hasTotal ? hud.totalMs : current.totalMs;
  const endsAt = hasEndsAt
    ? hud.endsAt
    : current.endsAt || (hasTotal ? now + totalMs : 0);

  const remainingMs =
    typeof hud.remainingMs === "number"
      ? hud.remainingMs
      : Math.max(0, endsAt - now);

  arenaStore.set({
    round: hud.round ?? current.round,
    type: hud.type ?? current.type,
    status: hud.status ?? current.status,

    players: Array.isArray(snap.players) ? snap.players : current.players,

    settings: snap.settings || current.settings,

    totalMs,
    endsAt,
    remainingMs,

    roundCutoff: snap.roundCutoff ?? current.roundCutoff,
    graceEnd: snap.graceEnd ?? current.graceEnd,
  });
}

export function updatePlayers(players) {
  if (!Array.isArray(players)) return;
  arenaStore.set({ players });
}

// ============================================================================
// HUD RING RENDER — TIMER IS ALWAYS DERIVED
// ============================================================================

export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  let total = (state.totalMs || 0) / 1000;
  let remaining = Math.max(0, (state.endsAt || 0) - now) / 1000;

  if (!total || total <= 0) {
    if (state.status === "active") {
      total = state.settings.roundDurationPre;
    } else if (state.status === "grace") {
      total = 5;
    }
  }

  const progress = total > 0 ? 1 - remaining / total : 0;
  ringEl.style.strokeDashoffset = circumference * progress;
}

// ============================================================================
// TWIST STORE — v9.0 (QUEUE ONLY, NO ARENA SIDE EFFECTS)
// ============================================================================

export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  step: null,
  payload: null,
  queue: [],
  lock: false,
});

// ============================================================================
// HARD RESET — TWIST QUEUE ONLY
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
  });

  try {
    if (window.FX && window.FX.clear) window.FX.clear();
  } catch {}

  try {
    if (window.disableGalaxyChaos) {
      const refs = window.cardRefs || [];
      window.disableGalaxyChaos(refs);
    }
  } catch {}

  console.log("%c[TWIST] Hard reset executed", "color:#ff4f4f");
};

// ============================================================================
// INTERNAL — PROCESS NEXT QUEUED TWIST
// ============================================================================

function processNextTwist() {
  const st = arenaTwistStore.get();
  if (st.lock || st.active || !st.queue.length) return;

  const next = st.queue[0];
  arenaTwistStore.set({ lock: true });

  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    step: next.step ?? null,
    payload: next.payload,
  });

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
  arenaTwistStore.set({ queue: [...st.queue, entry] });
  processNextTwist();
}

// ============================================================================
// PUBLIC API — ACTIVATE
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
