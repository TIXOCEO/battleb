// ============================================================================
// stores.js — BattleBox Overlay Stores (FULL v5.0)
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
// EVENTS STORE – MAX 10, fade via router
// ============================================================================
export const eventStore = createStore({
  events: [],
});

// Push new event at top
eventStore.pushEvent = (evt) => {
  evt.display_name = evt.display_name || "Onbekend";
  evt.username = evt.username || "";
  evt.reason = evt.reason || "";
  evt._fade = false;

  const list = eventStore.get().events;
  const next = [evt, ...list].slice(0, 10);

  eventStore.set({ events: next });
};

// Mark event for fade and remove
eventStore.fadeOutEvent = (ts) => {
  const list = eventStore.get().events.map((e) =>
    e.timestamp === ts ? { ...e, _fade: true } : e
  );

  eventStore.set({ events: list });

  // Remove after animation
  setTimeout(() => {
    const filtered = eventStore.get().events.filter((e) => e.timestamp !== ts);
    eventStore.set({ events: filtered });
  }, 600);
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
// SNAPSHOT
// ============================================================================
export function applySnapshot(snap) {
  if (!snap) return;

  // Queue
  if (snap.queue?.entries) {
    queueStore.setQueue(snap.queue.entries);
  }

  // Ticker
  if (snap.ticker) {
    tickerStore.setText(snap.ticker);
  }

  // Events from logs (converted → max 5)
  if (snap.logs) {
    const items = snap.logs.slice(0, 5).map((log) => ({
      type: log.type,
      timestamp: log.timestamp,
      display_name: log.message || "",
      username: "",
      reason: "",
      _fade: false,
    }));
    eventStore.set({ events: items });
  }
}
