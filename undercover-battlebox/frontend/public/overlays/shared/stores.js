// ============================================================================
// stores.js — BattleBox Overlay Stores v2.0 (Pure JS)
// Custom mini-Zustand engine → Works in OBS BrowserSource
// No bundler, no imports, no TypeScript.
// ============================================================================

// ---------------------------------------------------------
// INTERNAL MICRO-ZUSTAND ENGINE
// ---------------------------------------------------------

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    get: () => state,

    set: (partial) => {
      state = { ...state, ...partial };
      listeners.forEach((l) => l(state));
    },

    subscribe: (callback) => {
      listeners.add(callback);
      callback(state); // immediately notify

      return () => listeners.delete(callback);
    },
  };
}

// ============================================================================
// 1. QUEUE STORE (30-card grid)
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
  queueStore.set({
    lastUpdatedId: username,
  });
};

queueStore.clearHighlight = () => {
  queueStore.set({
    lastUpdatedId: null,
  });
};

// ============================================================================
// 2. EVENT STORE (latest 5 queue events)
// ============================================================================

export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  const current = eventStore.get().events;
  const next = [evt, ...current].slice(0, 5);

  eventStore.set({ events: next });
};

eventStore.fadeOutEvent = (timestamp) => {
  const current = eventStore.get().events;
  const filtered = current.filter((e) => e.timestamp !== timestamp);
  eventStore.set({ events: filtered });
};

// ============================================================================
// 3. TWIST STORE (rotating visible twists)
// ============================================================================

export const twistStore = createStore({
  visibleTwists: [],
});

twistStore.setTwists = (tw) => {
  twistStore.set({ visibleTwists: tw });
};

// ============================================================================
// 4. TICKER STORE (dynamic HUD text)
// ============================================================================

export const tickerStore = createStore({
  text: "BattleBox — The Ultimate Underground Arena",
});

tickerStore.setText = (txt) => {
  tickerStore.set({ text: txt });
};
