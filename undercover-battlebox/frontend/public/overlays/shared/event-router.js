// ============================================================================
// event-router.js — BattleBox Overlay Event Brain (ESPORTS v3)
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  twistStore,
  tickerStore
} from "/overlays/shared/stores.js";

// Placeholder avatar
const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

const TWIST_ROTATION_MS = 10000;
const EVENT_LIFETIME_MS = 6000;

// Prevent double-init
export function initEventRouter() {
  const socket = getSocket();
  if (window.__BB_ROUTER_ACTIVE__) return;
  window.__BB_ROUTER_ACTIVE__ = true;

  console.log("%c[BattleBox] Event Router Online", "color:#0fffd7;font-weight:bold;");

  // --------------------------------------------------------------------------
  // 1. updateQueue
  // --------------------------------------------------------------------------
  socket.on("updateQueue", (packet) => {
    if (!packet?.entries) return;

    const mapped = packet.entries.map((e) => ({
      position: e.position,
      display_name: e.display_name,
      username: e.username,
      priorityDelta: e.priorityDelta ?? 0,
      is_vip: !!e.is_vip,
      is_fan: !!e.is_fan,
      avatar_url: e.avatar_url || EMPTY_AVATAR,
    }));

    queueStore.getState().setQueue(mapped);
  });

  // --------------------------------------------------------------------------
  // 2. queueEvent
  // --------------------------------------------------------------------------
  socket.on("queueEvent", (evt) => {
    if (!evt?.type) return;

    // Add to event history
    eventStore.getState().pushEvent(evt);

    // Highlight queue card
    queueStore.getState().highlightCard(evt.username);

    setTimeout(() => {
      queueStore.getState().clearHighlight();
    }, 900);

    // Auto-remove event from feed
    setTimeout(() => {
      eventStore.getState().fadeOutEvent(evt.timestamp);
    }, EVENT_LIFETIME_MS);
  });

  // --------------------------------------------------------------------------
  // 3. Twist rotation
  // --------------------------------------------------------------------------
  let twistIndex = 0;

  const TWIST_MAP = {
    galaxy: {
      name: "Galaxy",
      gift: "Galaxy",
      diamonds: 1000,
      description: "Keert de ranking om.",
      aliases: ["galaxy", "gxy"],
    },
    moneygun: {
      name: "Money Gun",
      gift: "Money Gun",
      diamonds: 500,
      description: "Markeert een speler.",
      aliases: ["moneygun", "mg"],
    },
    bomb: {
      name: "Bomb",
      gift: "Bomb",
      diamonds: 2500,
      description: "Elimineert willekeurig.",
      aliases: ["bomb"],
    },
    immune: {
      name: "Immune",
      gift: "Immune",
      diamonds: 1599,
      description: "Beschermt tegen eliminatie.",
      aliases: ["immune", "save"],
    },
    heal: {
      name: "Heal",
      gift: "Heal",
      diamonds: 1500,
      description: "Verwijdert eliminatie.",
      aliases: ["heal"],
    },
    diamondpistol: {
      name: "Diamond Gun",
      gift: "Diamond Gun",
      diamonds: 5000,
      description: "1 speler overleeft.",
      aliases: ["dp", "pistol"],
    },
    breaker: {
      name: "Breaker",
      gift: "Breaker",
      diamonds: 899,
      description: "Verwijdert Immune.",
      aliases: ["breaker"],
    },
  };

  const twistKeys = Object.entries(TWIST_MAP).map(([key, def]) => ({
    key,
    ...def,
    icon: "/overlays/shared/default-icon.png",
  }));

  function rotateTwists() {
    const slice = twistKeys.slice(twistIndex, twistIndex + 3);

    if (slice.length < 3) {
      slice.push(...twistKeys.slice(0, 3 - slice.length));
    }

    twistStore.getState().setTwists(slice);

    twistIndex = (twistIndex + 3) % twistKeys.length;
  }

  rotateTwists();
  setInterval(rotateTwists, TWIST_ROTATION_MS);

  // --------------------------------------------------------------------------
  // 4. Ticker updates
  // --------------------------------------------------------------------------
  socket.on("hudTickerUpdate", (txt) => {
    tickerStore.getState().setText(txt);
  });
}
