// ============================================================================
// shared/stores.ts — BattleBox Overlay Stores (Zustand) v1.0
// No SSR • Overlay-safe • Socket-driven
// ============================================================================

import { create } from "zustand";

// ============================================================================
// TYPES
// ============================================================================

export interface QueueEntry {
  position: number;
  display_name: string;
  username: string;
  priorityDelta: number;
  is_vip: boolean;
  is_fan: boolean;
  avatar_url: string | null; // placeholder of echte avatar
}

export interface QueueEvent {
  type: "join" | "leave" | "promote" | "demote";
  tiktok_id: string;
  username: string;
  display_name: string;
  is_vip: boolean;
  timestamp: number;
}

export interface TwistItem {
  key: string;
  name: string;
  gift: string;
  diamonds: number;
  description: string;
  aliases: string[];
  icon: string;
}

// ============================================================================
// 1. QUEUE STORE (30 grid cards)
// ============================================================================

interface QueueState {
  entries: QueueEntry[];
  lastUpdatedId: string | null;

  setQueue: (entries: QueueEntry[]) => void;
  highlightCard: (username: string) => void;
  clearHighlight: () => void;
}

export const useQueueStore = create<QueueState>((set) => ({
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
// 2. EVENT STORE (last 5 overlay events)
// ============================================================================

interface EventState {
  events: QueueEvent[];
  pushEvent: (evt: QueueEvent) => void;
  fadeOutEvent: (timestamp: number) => void;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: [],

  pushEvent: (evt) => {
    const current = get().events;

    // always keep newest first
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
// 3. TWIST STORE (3 rotating visible twists)
// ============================================================================

interface TwistState {
  visibleTwists: TwistItem[];
  setTwists: (tw: TwistItem[]) => void;
}

export const useTwistStore = create<TwistState>((set) => ({
  visibleTwists: [],
  setTwists: (tw) => set({ visibleTwists: tw }),
}));

// ============================================================================
// (Optional) 4. TICKER STORE
// ============================================================================

interface TickerState {
  text: string;
  setText: (txt: string) => void;
}

export const useTickerStore = create<TickerState>((set) => ({
  text: "BattleBox — The Ultimate Underground Arena",
  setText: (t) => set({ text: t }),
}));
