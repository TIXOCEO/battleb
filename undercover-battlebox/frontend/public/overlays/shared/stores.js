// ============================================================================
// stores.js — BattleBox Overlay Stores (Pure JavaScript)
// Fully standalone — No Zustand, No external dependencies
// ============================================================================

// ---------------------------------------------------------------------------
// Helper: create a tiny reactive store
// ---------------------------------------------------------------------------

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    // get entire internal state
    get: () => state,

    // subscribe to changes
    subscribe(callback) {
      listeners.add(callback);
      // call immediately with current state
      callback(state);
      return () => listeners.delete(callback);
    },

    // update state
    set(partial) {
      state = { ...state, ...partial };
      listeners.forEach((cb) => cb(state));
    },
  };
}

// ============================================================================
// 1. QUEUE STORE (30 cards)
// ============================================================================

export const queueStore = createStore({
  entries: [],
  lastUpdatedId: null,
});

queueStore.setQueue = (entries) => {
  queueStore.set({
    entries,
    lastUpdatedId: null,
  });
};

queueStore.highlightCard = (username) => {
  queueStore.set({ lastUpdatedId: username });
};

queueStore.clearHighlight = () => {
  queueStore.set({ lastUpdatedId: null });
};

// ============================================================================
// 2. EVENTS STORE (max 5 items)
// ============================================================================

export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  const list = eventStore.get().events;
  const next = [evt, ...list].slice(0, 5);
  eventStore.set({ events: next });
};

eventStore.fadeOutEvent = (timestamp) => {
  const current = eventStore.get().events;
  const filtered = current.filter((e) => e.timestamp !== timestamp);
  eventStore.set({ events: filtered });
};

// ============================================================================
// 3. TWISTS STORE (3 rotating visible twists)
// ============================================================================

export const twistStore = createStore({
  visibleTwists: [],
});

twistStore.setTwists = (arr) => {
  twistStore.set({ visibleTwists: arr });
};

// ============================================================================
// 4. TICKER STORE
// ============================================================================

export const tickerStore = createStore({
  text: "BattleBox — The Ultimate Underground Arena",
});

tickerStore.setText = (txt) => {
  tickerStore.set({ text: txt });
};
