// ============================================================================
// event-router.js — BattleBox Event Brain v2.0 (TIMER-STABLE + SNAPSHOT-SAFE)
// ============================================================================
//
// ✔ NO duplicate listeners
// ✔ Clean queue event handling
// ✔ Arena snapshot loads new timer model (totalMs + endsAt)
// ✔ Round:start, round:grace, round:end fully patched
// ✔ Twist takeover stable
// ✔ Uses new avatar_url consistently (fallbacks intact)
// ✔ Fully backward-compatible with older engines
//
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  twistStore,
  tickerStore,
  applySnapshot
} from "/overlays/shared/stores.js";

import {
  arenaStore,
  arenaTwistStore
} from "/overlays/arena/arenaStore.js";

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

const QUEUE_EVENTS = new Set(["join", "leave", "promote", "demote"]);
let routerStarted = false;

// ============================================================================
// INITIALIZER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log(
    "%c[BattleBox] Event Router Ready (TIMER-STABLE ARENA VERSION)",
    "color:#0fffd7;font-weight:bold;"
  );

  // ==========================================================================
  // 1) INITIAL SNAPSHOT
  // ==========================================================================
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);

    // NEW: arena snapshot supports new timer model
    if (snap.arena) {
      arenaStore.set({
        ...snap.arena,
        // ensure missing timer keys don't break overlay
        totalMs: snap.arena.totalMs ?? 0,
        endsAt: snap.arena.endsAt ?? 0,
      });
    }
  });

  // ==========================================================================
  // 2) LIVE ARENA UPDATES
  // ==========================================================================
  socket.on("updateArena", (arena) => {
    if (!arena) return;

    arenaStore.set({
      ...arena,
      totalMs: arena.totalMs ?? 0,
      endsAt: arena.endsAt ?? 0,
    });

    document.dispatchEvent(
      new CustomEvent("arena:update", { detail: arena })
    );
  });

  // ==========================================================================
  // 3) ROUND START — NEW TIMER MODEL
  // ==========================================================================
  socket.on("round:start", (payload) => {
    // duration is ALWAYS in seconds from backend
    const total = (payload.duration ?? 0) * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "active",
      round: payload.round,
      type: payload.type || "quarter",
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

  // ==========================================================================
  // 4) GRACE START — NEW TIMER MODEL
  // ==========================================================================
  socket.on("round:grace", (payload) => {
    const total = (payload.grace ?? 5) * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "grace",
      round: payload.round,
      type: payload.type || "quarter",
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

  // ==========================================================================
  // 5) ROUND END — CLEAN RESET
  // ==========================================================================
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

  // ==========================================================================
  // 6) TWIST TAKEOVER + CLEAR
  // ==========================================================================
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

  // ==========================================================================
  // 7) LIVE QUEUE UPDATE
  // ==========================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  // ==========================================================================
  // 8) QUEUE EVENTS (join/leave/promote/demote)
  // ==========================================================================
  socket.on("queueEvent", (evt) => {
    if (!evt || !evt.type) return;
    if (!QUEUE_EVENTS.has(evt.type)) return;

    const safeDisplay =
      evt.display_name?.trim() ||
      evt.username?.trim() ||
      "Onbekend";

    const safeUsername =
      evt.username?.trim() ||
      safeDisplay.toLowerCase().replace(/\s+/g, "");

    const mapped = {
      type: evt.type,
      timestamp: evt.timestamp || Date.now(),
      display_name: safeDisplay,
      username: safeUsername,
      is_vip: !!evt.is_vip,
      avatar_url: evt.avatar_url || EMPTY_AVATAR,
      reason:
        evt.reason ??
        (evt.type === "join"
          ? "stapt de wachtrij binnen."
          : evt.type === "leave"
          ? "verlaat de wachtrij."
          : evt.type === "promote"
          ? "stijgt in positie."
          : "zakt in positie.")
    };

    eventStore.pushEvent(mapped);

    // highlight behavior
    if (mapped.username) {
      queueStore.highlightCard(mapped.username);
      setTimeout(() => queueStore.clearHighlight(), 900);
    }
  });

  // ==========================================================================
  // 9) TICKER UPDATE
  // ==========================================================================
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // ==========================================================================
  // 10) DEBUG BRIDGE
  // ==========================================================================
  window.bb = {
    socket,
    eventStore,
    arenaStore,
    twistStore,
  };

  console.log(
    "%c[BB DEBUG] Debug bridge active → window.bb",
    "color:#0fffd7"
  );
}
