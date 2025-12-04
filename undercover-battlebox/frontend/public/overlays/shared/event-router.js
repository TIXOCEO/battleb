// ============================================================================
// event-router.js — BattleBox Event Brain v1.8 FINAL
// ============================================================================
//
// ✔ NO double listeners
// ✔ NO fade-out
// ✔ NO loading old logs
// ✔ Strict queueEvent filtering
// ✔ Correct display_name/username fallback
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

const QUEUE_EVENTS = new Set(["join", "leave", "promote", "demote"]);
let routerStarted = false;

// ============================================================================
// MAIN ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log(
    "%c[BattleBox] Event Router Ready",
    "color:#0fffd7;font-weight:bold;"
  );

  // -------------------------------------------------
  // INITIAL SNAPSHOT — NO EVENTS LOADED FROM BACKEND
  // -------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);
  });

  // -------------------------------------------------
  // LIVE QUEUE UPDATES
  // -------------------------------------------------
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  // -------------------------------------------------
  // REALTIME QUEUE EVENTS (join/leave/promote/demote)
  // -------------------------------------------------
  socket.on("queueEvent", (evt) => {
    if (!evt || !evt.type) return;
    if (!QUEUE_EVENTS.has(evt.type)) return;

    // DISPLAY NAME + USERNAME FIX
    const safeDisplay =
      evt.display_name && evt.display_name.trim().length > 0
        ? evt.display_name
        : evt.username && evt.username.trim().length > 0
        ? evt.username
        : "Onbekend";

    const safeUsername =
      evt.username && evt.username.trim().length > 0
        ? evt.username
        : evt.display_name
        ? evt.display_name.toLowerCase().replace(/\s+/g, "")
        : "";

    const mapped = {
      type: evt.type,
      timestamp: evt.timestamp || Date.now(),
      display_name: safeDisplay,
      username: safeUsername,
      is_vip: !!evt.is_vip,
      avatar_url: evt.avatar_url || EMPTY_AVATAR,

      reason:
        evt.reason ||
        (evt.type === "join"
          ? "stapt de wachtrij binnen."
          : evt.type === "leave"
          ? "verlaat de wachtrij."
          : evt.type === "promote"
          ? "stijgt in positie."
          : "zakt in positie.")
    };

    eventStore.pushEvent(mapped);

    // Queue card highlight
    if (mapped.username) {
      queueStore.highlightCard(mapped.username);
      setTimeout(() => queueStore.clearHighlight(), 900);
    }
  });

  // -------------------------------------------------
  // TICKER UPDATE
  // -------------------------------------------------
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // -------------------------------------------------
  // DEBUG HELPERS
  // -------------------------------------------------
  window.bb = window.bb || {};
  window.bb.socket = socket;
  window.bb.eventStore = eventStore;

  window.bb.testEvent = () => {
    eventStore.pushEvent({
      type: "join",
      timestamp: Date.now(),
      display_name: "DebugUser",
      username: "debug",
      is_vip: false,
      reason: "debug test"
    });
  };

  console.log(
    "%c[BB DEBUG] Debug bridge active → window.bb",
    "color:#0fffd7"
  );
}
