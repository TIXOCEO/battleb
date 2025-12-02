// ============================================================================
// event-router.ts — BattleBox Overlay Event Brain v1.0
// Routes socket events → Zustand stores
// Handles: queue updates, events, twist rotation, fade timers
// ============================================================================

import { getSocket } from "./socket";
import {
  useQueueStore,
  useEventStore,
  useTwistStore,
  useTickerStore,
  QueueEntry,
  QueueEvent,
  TwistItem,
} from "./stores";

// ----------------------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------------------

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

// Twist rotation settings
const TWIST_ROTATION_MS = 10_000;

// Event fade-out timeout
const EVENT_LIFETIME_MS = 6_000;

// ----------------------------------------------------------------------------
// MAIN FUNCTION
// ----------------------------------------------------------------------------

export function initEventRouter() {
  const socket = getSocket();

  // Avoid double-binding if overlay reloads
  if ((window as any).__BB_ROUTER_ACTIVE__) return;
  (window as any).__BB_ROUTER_ACTIVE__ = true;

  console.log("%c[BattleBox] Event Router Active", "color:#0fffd7;font-weight:bold;");

  // ----------------------------------------------------------------------------
  // 1. updateQueue — full refresh of 30-card grid
  // ----------------------------------------------------------------------------
  socket.on("updateQueue", (packet: { open: boolean; entries: any[] }) => {
    if (!packet || !Array.isArray(packet.entries)) return;

    const mapped: QueueEntry[] = packet.entries.map((e) => ({
      position: e.position,
      display_name: e.display_name,
      username: e.username,
      priorityDelta: e.priorityDelta ?? 0,
      is_vip: !!e.is_vip,
      is_fan: !!e.is_fan,
      avatar_url: e.avatar_url || EMPTY_AVATAR,
    }));

    useQueueStore.getState().setQueue(mapped);
  });

  // ----------------------------------------------------------------------------
  // 2. queueEvent — join / leave / promote / demote
  // ----------------------------------------------------------------------------
  socket.on(
    "queueEvent",
    (evt: QueueEvent & { tiktok_id: string; username: string }) => {
      if (!evt?.type) return;

      // push to event store (right panel)
      useEventStore.getState().pushEvent(evt);

      // highlight card in queue grid
      useQueueStore.getState().highlightCard(evt.username);

      // clear highlight after short duration (CSS handles flash)
      setTimeout(() => {
        useQueueStore.getState().clearHighlight();
      }, 900);

      // timed fade-out for event list
      setTimeout(() => {
        useEventStore.getState().fadeOutEvent(evt.timestamp);
      }, EVENT_LIFETIME_MS);
    }
  );

  // ----------------------------------------------------------------------------
  // 3. Twist rotation — cycles every X seconds
  // ----------------------------------------------------------------------------
  let twistIndex = 0;

  const twistKeys: TwistItem[] = Object.entries(TWIST_MAP).map(([key, def]) => ({
    key,
    name: def.giftName,
    gift: def.giftName,
    diamonds: def.diamonds,
    description: def.description,
    aliases: [...def.aliases],
    icon: EMPTY_AVATAR, // replace later
  }));

  function rotateTwists() {
    const slice = twistKeys.slice(twistIndex, twistIndex + 3);

    // wrap around
    if (slice.length < 3) {
      const missing = 3 - slice.length;
      slice.push(...twistKeys.slice(0, missing));
    }

    useTwistStore.getState().setTwists(slice);

    twistIndex = (twistIndex + 3) % twistKeys.length;
  }

  rotateTwists();
  setInterval(rotateTwists, TWIST_ROTATION_MS);

  // ----------------------------------------------------------------------------
  // 4. Future: ticker updates (dynamic HUD broadcast text)
  // ----------------------------------------------------------------------------
  socket.on("hudTickerUpdate", (txt: string) => {
    useTickerStore.getState().setText(txt);
  });
}

// ============================================================================
// TWIST MAP (copied locally so overlay can render names/icons)
// In real setup you can import from shared/twist-definitions.ts
// ============================================================================
const TWIST_MAP = {
  // minimal version for overlays (only UI fields used)
  galaxy: {
    giftName: "Galaxy",
    diamonds: 1000,
    description: "Keert de ranking om.",
    aliases: ["galaxy", "gxy"],
  },
  moneygun: {
    giftName: "Money Gun",
    diamonds: 500,
    description: "Markeert speler voor eliminatie.",
    aliases: ["moneygun", "mg"],
  },
  bomb: {
    giftName: "Bomb",
    diamonds: 2500,
    description: "Markeert willekeurig een speler.",
    aliases: ["bomb"],
  },
  immune: {
    giftName: "Immune",
    diamonds: 1599,
    description: "Beschermt tegen eliminaties.",
    aliases: ["immune", "save"],
  },
  heal: {
    giftName: "Heal",
    diamonds: 1500,
    description: "Verwijdert eliminatie-mark.",
    aliases: ["heal"],
  },
  diamondpistol: {
    giftName: "Diamond Gun",
    diamonds: 5000,
    description: "Alleen gekozen speler overleeft.",
    aliases: ["dp", "pistol"],
  },
  breaker: {
    giftName: "Breaker",
    diamonds: 899,
    description: "Crackt of verwijdert immune.",
    aliases: ["breaker"],
  },
} as const;
