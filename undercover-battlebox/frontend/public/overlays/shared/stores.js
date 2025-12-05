// ============================================================================
// stores.js — BattleBox Overlay Stores (10-SLOT EVENTS — NO FADE VERSION)
// ============================================================================

// ✔ FIXED: export createStore zodat arenaStore.js het kan importeren
export function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get: () => state,

    subscribe(callback) {
      listeners.add(callback);
      callback(state);
      return () => listeners.delete(callback);
    },

    set(partial) {
      state = { ...state, ...partial };
      listeners.forEach((cb) => cb(state));
    },
  };
}

// ============================================================================
// QUEUE STORE
// ============================================================================
export const queueStore = createStore({
  entries: [],
  lastUpdatedId: null,
});

queueStore.setQueue = (entries) => {
  const slice = entries.slice(0, 15);
  while (slice.length < 15) slice.push(null);
  queueStore.set({ entries: slice, lastUpdatedId: null });
};

queueStore.highlightCard = (username) => {
  queueStore.set({ lastUpdatedId: username });
};

queueStore.clearHighlight = () => {
  queueStore.set({ lastUpdatedId: null });
};

// ============================================================================
// EVENTS STORE — 10 items, no auto fade
// ============================================================================
export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  const next = [evt, ...eventStore.get().events].slice(0, 10);
  eventStore.set({ events: next });
};

// No fading
eventStore.fadeOutEvent = () => {};

// ============================================================================
// TWIST STORE
// ============================================================================
export const twistStore = createStore({
  visibleTwists: [],
});

twistStore.setTwists = (arr) => {
  twistStore.set({ visibleTwists: arr });
};

// ============================================================================
// TICKER STORE
// ============================================================================
export const tickerStore = createStore({
  text: "BattleBox — The Ultimate Underground Arena",
});

tickerStore.setText = (txt) => {
  tickerStore.set({ text: txt });
};

// ============================================================================
// SNAPSHOT LOADER
// ============================================================================
export function applySnapshot(snap) {
  if (!snap) return;

  if (snap.queue?.entries) queueStore.setQueue(snap.queue.entries);
  if (snap.ticker) tickerStore.setText(snap.ticker);

  // Events blijven staan
}
