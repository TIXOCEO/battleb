// ============================================================================
// event-router.js — BattleBox Event Brain v2.1 (HUD-COMPAT FIXED)
// ============================================================================
//
// ✔ HUD wordt nu juist uitgepakt uit arena.hud
// ✔ arenaStore ontvangt totalMs / endsAt / remainingMs correct
// ✔ updateArena payload werkt opnieuw met arena.js
// ✔ Backwards compatible met oude payloads
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
    "%c[BattleBox] Event Router Ready (HUD-COMPAT v2.1)",
    "color:#0fffd7;font-weight:bold;"
  );

  // ==========================================================================
  // 1) INITIAL SNAPSHOT
  // ==========================================================================
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);

    if (snap.arena) {
      const hud = snap.arena.hud ?? snap.arena;

      arenaStore.set({
        ...snap.arena,
        totalMs: hud.totalMs ?? 0,
        endsAt: hud.endsAt ?? 0,
        remainingMs: hud.remainingMs ?? 0
      });
    }
  });

  // ==========================================================================
  // 2) LIVE ARENA UPDATES  (★ PATCHED FOR HUD MODEL ★)
  // ==========================================================================
  socket.on("updateArena", (pkt) => {
    if (!pkt) return;

    const hud = pkt.hud ?? {};

    arenaStore.set({
      ...pkt,
      totalMs: hud.totalMs ?? 0,
      endsAt: hud.endsAt ?? 0,
      remainingMs: hud.remainingMs ?? 0
    });

    document.dispatchEvent(
      new CustomEvent("arena:update", { detail: pkt })
    );
  });

  // ==========================================================================
  // 3) ROUND START — NEW TIMER MODEL
  // ==========================================================================
  socket.on("round:start", (payload) => {
    const total = (payload.duration ?? 0) * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "active",
      round: payload.round,
      type: payload.type || "quarter",
      totalMs: total,
      endsAt,
      remainingMs: total
    });

    document.dispatchEvent(new CustomEvent("arena:roundStart", { detail: payload }));
    window.dispatchEvent(new CustomEvent("round:start", { detail: payload }));
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
      remainingMs: total
    });

    document.dispatchEvent(new CustomEvent("arena:graceStart", { detail: payload }));
    window.dispatchEvent(new CustomEvent("round:grace", { detail: payload }));
  });

  // ==========================================================================
  // 5) ROUND END — CLEAN RESET
  // ==========================================================================
  socket.on("round:end", (payload) => {
    arenaStore.set({
      status: "ended",
      totalMs: 0,
      endsAt: 0,
      remainingMs: 0
    });

    document.dispatchEvent(new CustomEvent("arena:roundEnd", { detail: payload }));
    window.dispatchEvent(new CustomEvent("round:end", { detail: payload }));
  });

  // ==========================================================================
  // 6) TWISTS
  // ==========================================================================
  socket.on("twist:takeover", (p) => {
    arenaTwistStore.activate(p);
    document.dispatchEvent(new CustomEvent("arena:twistTakeover", { detail: p }));
  });

  socket.on("twist:clear", () => {
    arenaTwistStore.clear();
    document.dispatchEvent(new CustomEvent("arena:twistClear"));
  });

  // ==========================================================================
  // 7) LIVE QUEUE UPDATE
  // ==========================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  // ==========================================================================
  // 8) QUEUE EVENTS
  // ==========================================================================
  socket.on("queueEvent", (evt) => {
    if (!evt || !QUEUE_EVENTS.has(evt.type)) return;

    const safeDisplay = evt.display_name?.trim() || evt.username?.trim() || "Onbekend";
    const safeUsername = evt.username?.trim() || safeDisplay.toLowerCase().replace(/\s+/g, "");

    eventStore.pushEvent({
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
    });

    queueStore.highlightCard(safeUsername);
    setTimeout(() => queueStore.clearHighlight(), 900);
  });

  // ==========================================================================
  // 9) TICKER
  // ==========================================================================
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // ==========================================================================
  // 10) DEBUG BRIDGE
  // ==========================================================================
  window.bb = { socket, eventStore, arenaStore, twistStore };
  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7");
}
