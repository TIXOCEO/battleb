// ============================================================================
// event-router.js — BattleBox Event Brain v1.5 FINAL (with Debug Bridge)
// ============================================================================
// - Filters ONLY join/leave/promote/demote
// - Sends fade-out triggers
// - Handles snapshot, queue, twists, ticker
// - Adds DEBUG BRIDGE for OBS console: window.bb.socket, window.bb.eventStore, testEvent()
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  twistStore,
  tickerStore,
  applySnapshot
} from "/overlays/shared/stores.js";

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

const TWIST_ROTATION_MS = 10000;
const EVENT_LIFETIME_MS = 6000;

let routerStarted = false;

const QUEUE_EVENTS = new Set(["join", "leave", "promote", "demote"]);

// ============================================================================
// TWIST MAP (unchanged)
// ============================================================================
const TWIST_MAP = {
  galaxy: {
    giftName: "Galaxy",
    twistName: "Galaxy Twist",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/79a02148079526539f7599150da9fd28.png~tplv-obj.webp",
    diamonds: 1000,
    description: "Reverse op de ranking! Hoogste staat onderaan. Eindeloos te gebruiken!",
    aliases: ["galaxy", "gxy"]
  },

  moneygun: {
    giftName: "Money Gun",
    twistName: "Eliminatie",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/e0589e95a2b41970f0f30f6202f5fce6~tplv-obj.webp",
    diamonds: 500,
    description: "Elimineert speler aan einde van ronde.",
    aliases: ["moneygun", "mg"]
  },

  bomb: {
    giftName: "Space Dog",
    twistName: "Bomb",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/9154160eb6726193bc51f5007d5853fa.png~tplv-obj.webp",
    diamonds: 2500,
    description: "BOOM! Random eliminatie.",
    aliases: ["bomb"]
  },

  immune: {
    giftName: "Blooming Heart",
    twistName: "Immuniteit",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/ff5453b7569d482c873163ce4b1fb703.png~tplv-obj.webp",
    diamonds: 1599,
    description: "Voorkomt eliminatie (behalve Diamond Gun).",
    aliases: ["immune", "save"]
  },

  heal: {
    giftName: "Galaxy Globe",
    twistName: "Heal",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/1379dd334a16615a8731a3a4f97b932f.png~tplv-obj.webp",
    diamonds: 1500,
    description: "Herstel van eliminatie.",
    aliases: ["heal"]
  },

  diamondpistol: {
    giftName: "Diamond Gun",
    twistName: "Single Survivor",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/651e705c26b704d03bc9c06d841808f1.png~tplv-obj.webp",
    diamonds: 5000,
    description: "Elimineert iedereen behalve target.",
    aliases: ["dp", "pistol"]
  },

  breaker: {
    giftName: "Train",
    twistName: "Immune Breaker",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/4227ed71f2c494b554f9cbe2147d4899~tplv-obj.webp",
    diamonds: 899,
    description: "Breekt immuniteit na 2 hits.",
    aliases: ["breaker"]
  },
};

const twistKeys = Object.entries(TWIST_MAP).map(([key, t]) => ({
  key,
  giftName: t.giftName,
  twistName: t.twistName,
  gift: t.giftName,
  description: t.description,
  aliases: [...t.aliases],
  icon: t.icon || EMPTY_AVATAR
}));

// ============================================================================
// MAIN ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log("%c[BattleBox] Event Router Ready", "color:#0fffd7;font-weight:bold;");

  // Snapshot
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);
  });

  // Queue updates
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;

    const mapped = packet.entries.map((e) => ({
      position: e.position,
      display_name: e.display_name,
      username: e.username,
      priorityDelta: e.priorityDelta || 0,
      is_vip: !!e.is_vip,
      is_fan: !!e.is_fan,
      avatar_url: e.avatar_url || EMPTY_AVATAR,
    }));

    queueStore.setQueue(mapped);
  });

  // Queue events (ONLY join/leave/promote/demote)
  socket.on("queueEvent", (evt) => {
    if (!evt || !evt.type || !evt.user) return;
    if (!QUEUE_EVENTS.has(evt.type)) return;

    const mapped = {
      type: evt.type,
      timestamp: evt.timestamp || Date.now(),
      display_name: evt.user.display_name || "Onbekend",
      username: evt.user.username || "",
      is_vip: !!evt.user.is_vip,
      avatar_url: evt.user.avatar_url || EMPTY_AVATAR,
      reason:
        evt.reason ||
        (evt.type === "join"
          ? "stapt de wachtrij binnen."
          : evt.type === "leave"
          ? "verlaat de wachtrij."
          : evt.type === "promote"
          ? "stijgt in positie."
          : "zakt in positie."
        ),
    };

    eventStore.pushEvent(mapped);

    if (mapped.username) {
      queueStore.highlightCard(mapped.username);
      setTimeout(() => queueStore.clearHighlight(), 900);
    }

    setTimeout(() => {
      eventStore.fadeOutEvent(mapped.timestamp);
    }, EVENT_LIFETIME_MS);
  });

  // Twist rotation
  let twistIndex = 0;
  function rotateTwists() {
    const slice = twistKeys.slice(twistIndex, twistIndex + 3);
    if (slice.length < 3) slice.push(...twistKeys.slice(0, 3 - slice.length));

    twistStore.setTwists(slice);
    twistIndex = (twistIndex + 3) % twistKeys.length;
  }

  rotateTwists();
  setInterval(rotateTwists, TWIST_ROTATION_MS);

  // Ticker
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // ========================================================================
  // 🔥 DEBUG BRIDGE — make socket & stores available in OBS console
  // ========================================================================
  window.bb = window.bb || {};

  window.bb.socket = socket;
  window.bb.eventStore = eventStore;

  window.bb.testEvent = () => {
    const evt = {
      type: "join",
      timestamp: Date.now(),
      display_name: "DebugUser",
      username: "debug",
      is_vip: false,
      avatar_url: "",
      reason: "test event (debug bridge)"
    };
    eventStore.pushEvent(evt);
    console.log("%c[BB DEBUG] Test event pushed", "color:#0fffd7", evt);
  };

  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7;font-weight:bold;");
}
