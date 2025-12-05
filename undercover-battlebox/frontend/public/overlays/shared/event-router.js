// ============================================================================
// event-router.js — BattleBox Event Brain v1.8 FINAL + ARENA EXTENSIONS
// ============================================================================
//
// ✔ NO double listeners
// ✔ NO fade-out
// ✔ NO loading old logs
// ✔ Strict queueEvent filtering
// ✔ Correct display_name/username fallback
//
// ★ ADDITIONS:
//   + updateArena listener
//   + round lifecycle listeners  (PATCHED FOR TIMER)
//   + twist overlay listeners
//   + DOM event dispatch for arena.js animations
//   + load arena snapshot into arenaStore
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  twistStore,
  tickerStore,
  applySnapshot
} from "/overlays/shared/stores.js";

// ★ NEW — arena stores
import {
  arenaStore,
  arenaTwistStore
} from "/overlays/arena/arenaStore.js";

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
    "%c[BattleBox] Event Router Ready (ARENA EXTENDED)",
    "color:#0fffd7;font-weight:bold;"
  );

  // -------------------------------------------------
  // INITIAL SNAPSHOT — includes arena
  // -------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);

    if (snap.arena) {
      arenaStore.set(snap.arena);
    }
  });

  // -------------------------------------------------
  // ARENA — realtime update
  // -------------------------------------------------
  socket.on("updateArena", (arena) => {
    if (!arena) return;

    arenaStore.set(arena);

    document.dispatchEvent(
      new CustomEvent("arena:update", { detail: arena })
    );
  });

  // -------------------------------------------------
  // ROUND START — TIMER PATCH (totalMs + endsAt)
  // -------------------------------------------------
  socket.on("round:start", (payload) => {
    const total = payload.duration * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "active",
      round: payload.round,
      type: payload.type,
      totalMs: total,
      endsAt,
    });

    document.dispatchEvent(
      new CustomEvent("arena:roundStart", { detail: payload })
    );

    window.dispatchEvent(
      new CustomEvent("round:start", { detail: payload })
    );
  });

  // -------------------------------------------------
  // GRACE START — TIMER PATCH (totalMs + endsAt)
  // -------------------------------------------------
  socket.on("round:grace", (payload) => {
    const total = payload.grace * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "grace",
      round: payload.round,
      type: "quarter",
      totalMs: total,
      endsAt,
    });

    document.dispatchEvent(
      new CustomEvent("arena:graceStart", { detail: payload })
    );

    window.dispatchEvent(
      new CustomEvent("round:grace", { detail: payload })
    );
  });

  // -------------------------------------------------
  // ROUND END — NEW CLEAN ENDING MODEL
  // -------------------------------------------------
  socket.on("round:end", (payload) => {
    arenaStore.set({
      status: "ended",
      totalMs: 0,
      endsAt: 0,
    });

    document.dispatchEvent(
      new CustomEvent("arena:roundEnd", { detail: payload })
    );

    window.dispatchEvent(
      new CustomEvent("round:end", { detail: payload })
    );
  });

  // -------------------------------------------------
  // TWIST TAKEOVER
  // -------------------------------------------------
  socket.on("twist:takeover", (p) => {
    arenaTwistStore.activate(p);

    document.dispatchEvent(
      new CustomEvent("arena:twistTakeover", { detail: p })
    );
  });

  socket.on("twist:clear", () => {
    arenaTwistStore.clear();

    document.dispatchEvent(
      new CustomEvent("arena:twistClear")
    );
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
  window.bb.arenaStore = arenaStore;
  window.bb.twistStore = twistStore;

  console.log(
    "%c[BB DEBUG] Debug bridge active → window.bb (ARENA ENABLED)",
    "color:#0fffd7"
  );
}
