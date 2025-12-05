// ============================================================================
// event-router.js — BattleBox Event Brain v4.3 FINAL
// TARGET-ANIMATION PATCH + TWIST COUNTDOWN + FULL PAYLOAD NORMALIZATION
// ============================================================================
//
// Upgrades v4.3:
// -----------------------------------------------------
// ✔ Volledige normalisatie van twist payloads
// ✔ Betere bescherming tegen undefined target/victim names
// ✔ twist:countdown altijd type = "countdown"
// ✔ TwistQueue compatibel met v7.3 engine
// ✔ Overlay receives perfect payload: targetIndex, victimIndices, survivorIndex
// ✔ Geen functionaliteit verwijderd, alleen versterkt
//
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  tickerStore,
  applySnapshot
} from "/overlays/shared/stores.js";

import {
  arenaStore,
  arenaTwistStore,
  setArenaSnapshot
} from "/overlays/arena/arenaStore.js";

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

const QUEUE_EVENTS = new Set(["join", "leave", "promote", "demote"]);
let routerStarted = false;

// ============================================================================
// NORMALIZER — maakt ALLE arena updates uniform
// ============================================================================
function normalizeArena(pkt) {
  if (!pkt) return null;
  const hud = pkt.hud ?? pkt;

  const now = Date.now();
  const totalMs = hud.totalMs ?? 0;
  const remainingMs =
    hud.remainingMs ??
    Math.max(0, (hud.endsAt ?? 0) - now);

  return {
    ...pkt,
    round: pkt.round ?? hud.round ?? 0,
    type: pkt.type ?? hud.type ?? "quarter",
    status: pkt.status ?? hud.status ?? "idle",

    totalMs,
    endsAt: hud.endsAt ?? now + totalMs,
    remainingMs
  };
}

// ============================================================================
// INITIALIZER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log(
    "%c[BattleBox] Event Router Ready (v4.3 — Full Twist Payload + Countdown)",
    "color:#0fffd7;font-weight:bold;"
  );

  // ==========================================================================
  // 1) INITIAL SNAPSHOT
  // ==========================================================================
  socket.on("overlayInitialSnapshot", (snap) => {
    console.log("[DEBUG] Initial snapshot received:", snap);

    applySnapshot(snap);

    if (snap.arena) {
      setArenaSnapshot(snap.arena);
    }
  });

  // ==========================================================================
  // 2) LIVE ARENA UPDATES
  // ==========================================================================
  socket.on("updateArena", (pkt) => {
    console.log("[DEBUG] updateArena received:", pkt);

    const norm = normalizeArena(pkt);
    if (norm) arenaStore.set(norm);

    document.dispatchEvent(
      new CustomEvent("arena:update", { detail: norm })
    );
  });

  // ==========================================================================
  // 3) ROUND START
  // ==========================================================================
  socket.on("round:start", (payload) => {
    console.log("[DEBUG] round:start:", payload);

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
  // 4) GRACE START
  // ==========================================================================
  socket.on("round:grace", (payload) => {
    console.log("[DEBUG] round:grace:", payload);

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
  // 5) ROUND END
  // ==========================================================================
  socket.on("round:end", (payload) => {
    console.log("[DEBUG] round:end:", payload);

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
  // 6) TWISTS — TAKEOVER + FULL PAYLOAD
  // ==========================================================================
  socket.on("twist:takeover", (raw) => {
    console.log("[DEBUG] twist:takeover received:", raw);

    const payload = {
      type: raw.type,

      title: raw.title || "",

      // target
      targetId: raw.targetId ?? null,
      targetName: raw.targetName || null,
      targetIndex: Number.isFinite(raw.targetIndex) ? raw.targetIndex : null,

      // victims
      victimIds: Array.isArray(raw.victimIds) ? raw.victimIds : [],
      victimNames: Array.isArray(raw.victimNames) ? raw.victimNames : [],
      victimIndices: Array.isArray(raw.victimIndices) ? raw.victimIndices : [],

      // survivor
      survivorId: raw.survivorId ?? null,
      survivorName: raw.survivorName || null,
      survivorIndex: Number.isFinite(raw.survivorIndex)
        ? raw.survivorIndex
        : null,

      // galaxy
      reverse: raw.reverse ?? false
    };

    arenaTwistStore.activate(payload);

    document.dispatchEvent(
      new CustomEvent("arena:twistTakeover", { detail: payload })
    );
  });

  socket.on("twist:clear", () => {
    console.log("[DEBUG] twist:clear");

    arenaTwistStore.clear();

    document.dispatchEvent(new CustomEvent("arena:twistClear"));
  });

  // ==========================================================================
  // 6B) TWIST COUNTDOWN (3 → 2 → 1)
  // ==========================================================================
  socket.on("twist:countdown", (raw) => {
    console.log("[DEBUG] twist:countdown:", raw);

    const payload = {
      type: "countdown",
      step: raw.step ?? 3,
      by: raw.by || ""
    };

    arenaTwistStore.countdown(payload);

    document.dispatchEvent(
      new CustomEvent("arena:twistCountdown", { detail: payload })
    );
  });

  // ==========================================================================
  // 7) QUEUE UPDATE
  // ==========================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;

    console.log("[DEBUG] updateQueue:", packet);
    queueStore.setQueue(packet.entries);
  });

  // ==========================================================================
  // 8) QUEUE EVENTS (JOIN / LEAVE / PROMOTE / DEMOTE)
  // ==========================================================================
  socket.on("queueEvent", (evt) => {
    console.log("[DEBUG] queueEvent:", evt);

    if (!evt || !QUEUE_EVENTS.has(evt.type)) return;

    const safeDisplay =
      evt.display_name?.trim() || evt.username?.trim() || "Onbekend";

    const safeUsername =
      evt.username?.trim() ||
      safeDisplay.toLowerCase().replace(/\s+/g, "");

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
  // 9) HUD TICKER
  // ==========================================================================
  socket.on("hudTickerUpdate", (text) => {
    console.log("[DEBUG] ticker:", text);
    tickerStore.setText(text || "");
  });

  // ==========================================================================
  // 10) DEBUG BRIDGE
  // ==========================================================================
  window.bb = { socket, eventStore, arenaStore, arenaTwistStore };
  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7");
}
