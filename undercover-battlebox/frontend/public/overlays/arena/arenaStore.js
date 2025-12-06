// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (v7.4 FINAL)
// TARGET PAYLOAD + COUNTDOWN + FULL TWIST QUEUE
// ============================================================================
//
// Upgrades in v7.4:
// ---------------------------------------
// ✔ COMPLETE twist payload support (targetId / Index / victims[] / survivor)
// ✔ arenaTwistStore.queue bevat nu VOLLEDIGE PAYLOADS
// ✔ Nieuwe: arenaTwistStore.countdown(payload)
// ✔ Nieuwe: arenaTwistStore.pushPayload(payload)
// ✔ activate() ondersteunt nu volledige payloads i.p.v. enkel type/title
// ✔ TwistQueue werkt nu correct bij countdown → takeover → clear
// ✔ normalizeArenaPayload verbeterd
//
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

  // legacy
  roundCutoff: 0,
  graceEnd: 0,
});

// ============================================================================
// NORMALIZER — maakt ALLE arena payloads uniform
// ============================================================================
function normalizeArenaPayload(snap) {
  if (!snap) return {};

  const hud = snap.hud ?? snap;
  const now = Date.now();

  const totalMs = hud.totalMs ?? 0;
  const remainingMs =
    hud.remainingMs ?? Math.max(0, (hud.endsAt ?? 0) - now);

  return {
    round: snap.round ?? hud.round ?? 0,
    type: snap.type ?? hud.type ?? "quarter",
    status: snap.status ?? hud.status ?? "idle",

    players: snap.players ?? [],

    settings: snap.settings || arenaStore.get().settings,

    totalMs,
    endsAt: hud.endsAt ?? now + totalMs,
    remainingMs,

    roundCutoff: snap.roundCutoff ?? 0,
    graceEnd: snap.graceEnd ?? 0,
  };
}

// ============================================================================
// SNAPSHOT HANDLING
// ============================================================================
export function setArenaSnapshot(snap) {
  const updated = normalizeArenaPayload(snap);
  arenaStore.set(updated);
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
// TWIST STORE — v7.4 (FULL PAYLOAD QUEUE ENGINE)
// ============================================================================
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  step: null, // countdown step
  queue: [],
  payload: null, // entire twist payload
});

// ============================================================================
// INTERNAL — START NEXT IN QUEUE
// ============================================================================
function processNextTwist() {
  const st = arenaTwistStore.get();

  if (st.active) return;
  if (!st.queue.length) return;

  const next = st.queue.shift();

  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    payload: next.payload,
    step: next.step ?? null,
    queue: st.queue,
  });
}

// ============================================================================
// PUBLIC API — ACTIVATE (queue safe)
// ============================================================================
arenaTwistStore.activate = (payload) => {
  if (!payload) return;

  const st = arenaTwistStore.get();

  const entry = {
    type: payload.type ?? null,
    title: payload.title ?? "",
    step: payload.step ?? null,
    payload: payload,
  };

  if (st.active) {
    arenaTwistStore.set({
      ...st,
      queue: [...st.queue, entry],
    });
    return;
  }

  // immediate start
  arenaTwistStore.set({
    active: true,
    type: entry.type,
    title: entry.title,
    step: entry.step,
    payload: payload,
    queue: st.queue,
  });
};

// ============================================================================
// NEW — COUNTDOWN (bomb 3 → 2 → 1)
// ============================================================================
arenaTwistStore.countdown = (payload) => {
  if (!payload) return;

  const st = arenaTwistStore.get();

  const c = {
    type: "countdown",
    title: "",
    step: payload.step,
    payload: payload,
  };

  if (st.active) {
    arenaTwistStore.set({
      ...st,
      queue: [...st.queue, c],
    });
    return;
  }

  arenaTwistStore.set({
    active: true,
    type: "countdown",
    title: "",
    step: payload.step,
    payload,
    queue: st.queue,
  });
};

// ============================================================================
// CLEAR — end current animation & process next
// ============================================================================
arenaTwistStore.clear = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
    step: null,
    payload: null,
  });

  setTimeout(processNextTwist, 50);
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
