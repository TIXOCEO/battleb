// ============================================================================
// stores.js — BattleBox Overlay Stores (10-SLOT EVENTS — NO FADE VERSION)
// ============================================================================

// ✔ createStore is nu een NAMED EXPORT
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

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

// ============================================================================
// QUEUE STORE (unchanged)
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
// EVENTS STORE — 10 items, new on top, NEVER auto-fade
// ============================================================================
export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  const next = [evt, ...eventStore.get().events].slice(0, 10);
  eventStore.set({ events: next });
};

// fadeOutEvent does NOTHING now
eventStore.fadeOutEvent = () => {};

// ============================================================================
// TWISTS STORE
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
  text: "Welkom bij Underground BattleBox — The Ultimate Arena | Strijd mee om de winst, of strijd tegen de winst! | Koop je twists bij de host en bedenk je strategie | Ledenhartje + !join om de wachtrij te joinen | !use [twist] [@target] om Twist te gebruiken! | Winnaar pakt 40% van de totale opbrengst van de stream | ",
});

tickerStore.setText = (txt) => {
  tickerStore.set({ text: txt });
};

// ============================================================================
// SNAPSHOT LOADER — no event injection, no resetting events
// ============================================================================
export function applySnapshot(snap) {
  if (!snap) return;

  if (snap.queue?.entries) queueStore.setQueue(snap.queue.entries);
  if (snap.ticker) tickerStore.setText(snap.ticker);

  // ✔ DO NOT override eventStore
  // events blijven zoals ze zijn
}
