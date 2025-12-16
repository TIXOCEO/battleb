// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store
// v9.1 TWIST STABILITY PATCH
// ============================================================================
//
// FIXES:
// ✔ active/lock deadlock preventie
// ✔ queue processing altijd gegarandeerd
// ✔ HUD-only twists kunnen niet meer blijven hangen
// ✔ compatibel met instant-finalize backend twists
//
// GEEN FEATURE CHANGES
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ============================================================================
// ARENA STATE (HUD-MODEL v3 — ongewijzigd)
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

// ============================================================================
// HUD RING RENDER — ongewijzigd
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
// TWIST STORE — PATCHED CORE
// ============================================================================

export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  step: null,
  payload: null,

  queue: [],
  lock: false,

  // 🔒 NEW: watchdog timestamp
  activeSince: 0,
});

// ============================================================================
// HARD RESET — TWIST QUEUE ONLY (VERBETERD)
// ============================================================================
//
// ⚠️ BELANGRIJK:
// - reset NOOIT arenaStore
// - reset ALLEEN twist-runtime
// - veilig bij round:start / arena:reset
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
    activeSince: 0,
  });

  try {
    if (window.FX?.clear) window.FX.clear();
  } catch {}

  console.log("%c[TWIST] Hard reset executed", "color:#ff4f4f");
};

// ============================================================================
// INTERNAL — PROCESS NEXT QUEUED TWIST (PATCHED)
// ============================================================================
//
// GARANTIES:
// - nooit overschrijven van actieve twist
// - nooit vastlopen door lock
// - altijd FIFO
// ============================================================================

function processNextTwist() {
  const st = arenaTwistStore.get();

  // ⛔ harde guards
  if (st.lock) return;
  if (st.active) return;
  if (!st.queue.length) return;

  const next = st.queue[0];

  arenaTwistStore.set({ lock: true });

  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    step: next.step ?? null,
    payload: next.payload,
    activeSince: Date.now(), // 🆕 watchdog startpunt
  });

  arenaTwistStore.set({
    queue: st.queue.slice(1),
    lock: false,
  });
}

// ============================================================================
// WATCHDOG — ABSOLUTE FAILSAFE
// ============================================================================
//
// Waarom nodig:
// - OBS kan animationend missen
// - CSS kan falen
// - JS kan onderbroken worden
//
// → nooit meer een vastlopende twist
// ============================================================================

setInterval(() => {
  const st = arenaTwistStore.get();
  if (!st.active || !st.activeSince) return;

  const elapsed = Date.now() - st.activeSince;

  if (elapsed > 6000) {
    console.warn(
      "[TWIST] Watchdog force-clear:",
      st.type,
      `(${elapsed}ms)`
    );

    arenaTwistStore.clear();
  }
}, 500);

// ============================================================================
// INTERNAL — ENQUEUE (SAFE)
// ============================================================================

function enqueue(entry) {
  const st = arenaTwistStore.get();
  arenaTwistStore.set({
    queue: [...st.queue, entry],
  });

  processNextTwist();
}

// ============================================================================
// PUBLIC API — ACTIVATE (PATCHED)
// ============================================================================
//
// ❗ active twists worden NOOIT vervangen
// ❗ alles loopt via queue
// ❗ backend mag onbeperkt pushen
// ============================================================================

arenaTwistStore.activate = (payload) => {
  if (!payload || !payload.type) return;

  enqueue({
    type: payload.type,
    title: payload.title ?? "",
    step: payload.step ?? null,
    payload,
  });
};

// ============================================================================
// PUBLIC API — COUNTDOWN (UNCHANGED)
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
// CLEAR — END CURRENT & PROCESS NEXT (PATCHED)
// ============================================================================
//
// ⚠️ clear() is nu:
// - idempotent
// - veilig bij dubbele calls
// - triggert ALTIJD volgende twist
// ============================================================================

arenaTwistStore.clear = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
    step: null,
    payload: null,
    activeSince: 0,
  });

  processNextTwist();
};

// ============================================================================
// OPTIONAL — FORCE FLUSH (ADMIN / DEBUG)
// ============================================================================

arenaTwistStore.forceFlush = () => {
  arenaTwistStore.resetAll();
  console.log(
    "%c[TWIST] Force-flush executed (manual)",
    "color:#ff9f00"
  );
};

// ============================================================================
// EXPORT
// ============================================================================

export default {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot,
  renderHudProgress,
};
