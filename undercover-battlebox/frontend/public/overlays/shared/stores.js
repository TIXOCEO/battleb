// ============================================================================
// stores.js — BattleBox Overlay Stores (15-SLOT EDITION)
// ============================================================================

function createStore(initialState) {
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

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

// ============================================================================
// 1. QUEUE STORE — ALWAYS 15 visible slots
// ============================================================================
export const queueStore = createStore({
  entries: [],
  lastUpdatedId: null,
});

queueStore.setQueue = (entries) => {
  // Only the FIRST 15 entries matter for the overlay
  const sliced = entries.slice(0, 15);

  // Pad with free slots until 15
  while (sliced.length < 15) sliced.push(null);

  queueStore.set({
    entries: sliced,
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
// 2. EVENTS STORE
// ============================================================================
export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  evt.display_name = evt.display_name || "Onbekend";
  evt.username = evt.username || "";
  evt.reason = evt.reason || "";

  const list = eventStore.get().events;
  const next = [evt, ...list].slice(0, 5);
  eventStore.set({ events: next });
};

eventStore.fadeOutEvent = (ts) => {
  const current = eventStore.get().events;
  const filtered = current.filter((e) => e.timestamp !== ts);
  eventStore.set({ events: filtered });
};

// ============================================================================
// 3. TWISTS STORE
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
