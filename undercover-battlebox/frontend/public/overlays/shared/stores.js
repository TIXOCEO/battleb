// ============================================================================
// stores.js — BattleBox Overlay Stores (Zustand, pure JS)
// ============================================================================

import { create } from "zustand";

// ============================================================================
// 1. QUEUE STORE (30 cards)
// ============================================================================

export const useQueueStore = create((set) => ({
  entries: [],
  lastUpdatedId: null,

  setQueue: (entries) =>
    set({
      entries,
      lastUpdatedId: null,
    }),

  highlightCard: (username) =>
    set({
      lastUpdatedId: username,
    }),

  clearHighlight: () =>
    set({
      lastUpdatedId: null,
    }),
}));

// ============================================================================
// 2. EVENTS STORE (max 5 events)
// ============================================================================

export const useEventStore = create((set, get) => ({
  events: [],

  pushEvent: (evt) => {
    const current = get().events;
    const next = [evt, ...current].slice(0, 5);
    set({ events: next });
  },

  fadeOutEvent: (timestamp) => {
    const current = get().events;
    const filtered = current.filter((e) => e.timestamp !== timestamp);
    set({ events: filtered });
  },
}));

// ============================================================================
// 3. TWISTS STORE (3 rotating visible twists)
// ============================================================================

export const useTwistStore = create((set) => ({
  visibleTwists: [],
  setTwists: (tw) => set({ visibleTwists: tw }),
}));

// ============================================================================
// 4. TICKER STORE
// ============================================================================

export const useTickerStore = create((set) => ({
  text: "BattleBox — The Ultimate Underground Arena",
  setText: (txt) => set({ text: txt }),
}));
