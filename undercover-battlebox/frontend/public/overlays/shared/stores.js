// ============================================================================
// stores.js — BattleBox Overlay Stores (10-SLOT EVENTS EDITION)
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
// QUEUE STORE — unchanged
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
// EVENTS STORE — FIXED FOR 10 EVENTS + FADE MARKING
// ============================================================================
export const eventStore = createStore({
  events: [],
});

eventStore.pushEvent = (evt) => {
  evt.display_name = evt.display_name || "Onbekend";
  evt.username = evt.username || "";
  evt.reason = evt.reason || "";
  evt._fade = false;

  const list = eventStore.get().events;
  const next = [evt, ...list].slice(0, 10);   // ⭐ MAX 10 events
  eventStore.set({ events: next });
};

eventStore.fadeOutEvent = (ts) => {
  const updated = eventStore.get().events.map((e) =>
    e.timestamp === ts ? { ...e, _fade: true } : e
  );
  eventStore.set({ events: updated });
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
// SNAPSHOT LOADER
// ============================================================================
export function applySnapshot(snap) {
  if (!snap) return;

  if (snap.queue?.entries) queueStore.setQueue(snap.queue.entries);
  if (snap.ticker) tickerStore.setText(snap.ticker);

  if (snap.logs) {
    const items = snap.logs.slice(0, 10).map((log) => ({
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
