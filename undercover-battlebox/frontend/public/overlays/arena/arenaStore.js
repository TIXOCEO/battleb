// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (HUD-COMPAT v6.3 FINAL)
// ============================================================================
//
// Upgrades in v6.3:
// ---------------------------------------
// ✔ Twist QUEUE toegevoegd (geen verloren animaties meer)
// ✔ HUD-normalizer voor alle updateArena payloads
// ✔ Fallbacks versterkt voor oude engines (<16.7)
// ✔ remainingMs + endsAt altijd correct gesynchroniseerd
// ✔ Snapshot verwerkt round/type/status consistenter
// ✔ title-fallback in twistStore (garanteert animatiestart)
//
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ============================================================================
// ARENA STATE (HUD-MODEL v2)
// ============================================================================
export const arenaStore = createStore({
  round: 0,
  type: "quarter",
  status: "idle",

  players: [],

  // HUD fields
  totalMs: 0,
  endsAt: 0,
  remainingMs: 0,

  settings: {
    roundDurationPre: 30,
    roundDurationFinal: 300,
  },

  // legacy fallback
  roundCutoff: 0,
  graceEnd: 0,
});

// ============================================================================
// INTERNAL NORMALIZER — zorgt dat ALLE payloads dezelfde vorm krijgen
// ============================================================================
function normalizeArenaPayload(snap) {
  if (!snap) return {};

  const hud = snap.hud ?? snap;
  const now = Date.now();

  const totalMs = hud.totalMs ?? 0;
  const remainingMs = hud.remainingMs ?? Math.max(0, (hud.endsAt ?? 0) - now);

  return {
    round: snap.round ?? hud.round ?? 0,
    type: snap.type ?? hud.type ?? "quarter",
    status: snap.status ?? hud.status ?? "idle",

    players: snap.players ?? [],

    settings: snap.settings || arenaStore.get().settings,

    totalMs,
    endsAt: hud.endsAt ?? (now + totalMs),
    remainingMs,

    roundCutoff: snap.roundCutoff ?? 0,
    graceEnd: snap.graceEnd ?? 0,
  };
}

// ============================================================================
// SNAPSHOT LOADER
// ============================================================================
export function setArenaSnapshot(snap) {
  const updated = normalizeArenaPayload(snap);
  arenaStore.set(updated);
}

// ============================================================================
// ONLY PLAYER ARRAY CHANGES
// ============================================================================
export function updatePlayers(players) {
  arenaStore.set({ players });
}

// ============================================================================
// HUD PROGRESS RING (new HUD model + legacy fallback)
// ============================================================================
export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  let total = (state.totalMs || 0) / 1000;
  let remaining = (state.remainingMs || 0) / 1000;

  // als remainingMs leeg is → bereken via endsAt
  if (!remaining || remaining <= 0) {
    remaining = Math.max(0, (state.endsAt - now) / 1000);
  }

  // fallback voor oude engine
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
// TWIST STORE — **NIEUW: TWIST QUEUE SYSTEM**
// ============================================================================

export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
  queue: [],     // <—— nieuw
});

// Helper: start next twist from queue
function processNextTwist() {
  const st = arenaTwistStore.get();

  if (st.active) return;
  if (st.queue.length === 0) return;

  const next = st.queue.shift();

  arenaTwistStore.set({
    active: true,
    type: next.type,
    title: next.title,
    queue: st.queue,
  });
}

// ACTIVATE (queue-aware)
arenaTwistStore.activate = (payload) => {
  const type =
    typeof payload === "string"
      ? payload
      : payload?.type ?? null;

  const title =
    typeof payload === "string"
      ? ""
      : payload?.title ?? "";

  const current = arenaTwistStore.get();

  // als er al een animatie actief is → queue
  if (current.active) {
    arenaTwistStore.set({
      ...current,
      queue: [...current.queue, { type, title }],
    });
    return;
  }

  // direct starten
  arenaTwistStore.set({
    active: true,
    type,
    title,
    queue: current.queue,
  });
};

// CLEAR → active stoppen + volgende starten
arenaTwistStore.clear = () => {
  arenaTwistStore.set({
    active: false,
    type: null,
    title: "",
  });

  // start volgende als die bestaat
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
