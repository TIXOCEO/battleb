// ============================================================================
// arenaStore.js — BattleBox Arena Overlay Store (HUD-COMPAT v6.2 FINAL)
// ============================================================================
//
// Upgrades in deze versie:
// ---------------------------------------
// ✔ FIX #1 — snapshot verwerkt nu round/type uit HUD-model
// ✔ FIX #2 — remainingMs wordt actief ondersteund in HUD
// ✔ FIX #3 — twistStore verwerkt title + fallback correct
// ✔ FIX #4 — renderHudProgress gebruikt nieuwe HUD-model + fallback
// ✔ Backwards compatible met oude roundCutoff/graceEnd
//
// ============================================================================

import { createStore } from "/overlays/shared/stores.js";

// ============================================================================
// ARENA STATE (nieuw HUD-model)
// ============================================================================
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

  // OLD fallback fields (server < v16.7)
  roundCutoff: 0,
  graceEnd: 0,
});

// ============================================================================
// SNAPSHOT — ondersteunt HUD en oude veldnamen
// ============================================================================
export function setArenaSnapshot(snap) {
  if (!snap) return;

  const hud = snap.hud ?? snap;

  arenaStore.set({
    // FIX #1 — round & type moeten uit zowel snap als hud komen
    round: snap.round ?? hud.round ?? 0,
    type: snap.type ?? hud.type ?? "quarter",
    status: snap.status ?? "idle",

    players: snap.players ?? [],

    settings: snap.settings || arenaStore.get().settings,

    // NEW HUD fields
    totalMs: hud.totalMs ?? 0,
    endsAt: hud.endsAt ?? 0,
    remainingMs: hud.remainingMs ?? 0,

    // fallback voor oude engine
    roundCutoff: snap.roundCutoff ?? 0,
    graceEnd: snap.graceEnd ?? 0,
  });
}

// ============================================================================
// ONLY PLAYERS CHANGE
// ============================================================================
export function updatePlayers(players) {
  arenaStore.set({ players });
}

// ============================================================================
// HUD RING — gebruikt nieuwe HUD-model + fallback
// ============================================================================
export function renderHudProgress(state, ringEl) {
  if (!ringEl) return;

  const radius = 170;
  const circumference = 2 * Math.PI * radius;
  ringEl.style.strokeDasharray = `${circumference}`;

  const now = Date.now();

  // -------------------------
  // NEW HUD METHOD
  // -------------------------
  let total = (state.totalMs || 0) / 1000;
  let remaining = (state.remainingMs || 0) / 1000;

  // als remainingMs niet bestaat → bereken vanuit endsAt
  if (!remaining || remaining <= 0) {
    remaining = Math.max(0, (state.endsAt - now) / 1000);
  }

  // -------------------------
  // FALLBACK VOOR OUDE ENGINES
  // -------------------------
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
// TWIST STORE — ondersteunt zowel payload als losse type-string
// ============================================================================
export const arenaTwistStore = createStore({
  active: false,
  type: null,
  title: "",
});

arenaTwistStore.activate = (payload) => {
  // FIX #3 — title fallback zodat animaties WEL starten
  const type =
    typeof payload === "string"
      ? payload
      : payload?.type ?? null;

  const title =
    typeof payload === "string"
      ? ""
      : payload?.title ?? "";

  arenaTwistStore.set({
    active: true,
    type,
    title,
  });
};

arenaTwistStore.clear = () => {
  arenaTwistStore.set({ active: false, type: null, title: "" });
};

// ============================================================================
// EXPORTS
// ============================================================================
export default {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot,
  updatePlayers,
  renderHudProgress,
};
