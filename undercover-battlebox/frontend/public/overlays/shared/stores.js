// ============================================================================
// stores.js — BattleBox Overlay Stores (SNAPSHOT + 15-SLOT EDITION)
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
// QUEUE STORE — 15 visible slots, filled + padded
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
// EVENTS STORE
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
  text: "BattleBox — The Ultimate Underground Arena",
});

tickerStore.setText = (txt) => {
  tickerStore.set({ text: txt });
};

// ============================================================================
// SNAPSHOT API — overlayInitialSnapshot handler
// ============================================================================
export function applySnapshot(snap) {
  if (!snap) return;

  // 1) Queue
  if (snap.queue?.entries) {
    queueStore.setQueue(snap.queue.entries);
  }

  // 2) Ticker (optional)
  if (snap.ticker) {
    tickerStore.setText(snap.ticker);
  }

  // 3) Events (admin logs → we convert last 5)
  if (snap.logs) {
    const items = snap.logs.slice(0, 5).map((log) => ({
      type: log.type,
      timestamp: log.timestamp,
      display_name: log.message || "",
      username: "",
      reason: "",
    }));
    eventStore.set({ events: items });
  }

  // 4) Twists — loaded with default map (rotation will refresh)
  // nothing needed here
}
