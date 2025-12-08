// ============================================================================
// event-router.js — BattleBox Event Brain v5.1 HARD-RESET EDITION
// FULL TWIST PAYLOAD SYNC + QUEUE-SAFE + NAME FIXES + COUNTDOWN SUPPORT
// Compatible with arenaStore v9.0 and arena.js v9.2
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  tickerStore,
  twistStore,
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
// NORMALIZER (arena)
// ============================================================================
function normalizeArena(pkt) {
  if (!pkt) return null;

  const hud = pkt.hud || pkt;
  const now = Date.now();

  const totalMs = hud.totalMs || 0;
  const remainingMs =
    hud.remainingMs ||
    Math.max(0, (hud.endsAt || 0) - now);

  return {
    ...pkt,
    round: pkt.round || hud.round || 0,
    type: pkt.type || hud.type || "quarter",
    status: pkt.status || hud.status || "idle",

    totalMs,
    endsAt: hud.endsAt || now + totalMs,
    remainingMs
  };
}

// ============================================================================
// LEGACY TWIST MAP
// ============================================================================
const TWIST_MAP = {
  galaxy: {
    giftName: "Galaxy",
    twistName: "Galaxy Twist",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/79a02148079526539f7599150da9fd28.png~tplv-obj.webp",
    diamonds: 1000,
    description: "Reverse ranking!",
    aliases: ["galaxy", "gxy"]
  },

  moneygun: {
    giftName: "Money Gun",
    twistName: "Eliminatie",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/e0589e95a2b41970f0f30f6202f5fce6~tplv-obj.webp",
    diamonds: 500,
    description: "Markeert target eliminatie.",
    aliases: ["moneygun", "mg"]
  },

  bomb: {
    giftName: "Space Dog",
    twistName: "Bomb",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/9154160eb6726193bc51f5007d5853fa.png~tplv-obj.webp",
    diamonds: 2500,
    description: "Random BOOM.",
    aliases: ["bomb"]
  },

  immune: {
    giftName: "Blooming Heart",
    twistName: "Immuniteit",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/ff5453b7569d482c873163ce4b1fb703.png~tplv-obj.webp",
    diamonds: 1599,
    description: "Beschermt tegen eliminatie.",
    aliases: ["immune", "save"]
  },

  heal: {
    giftName: "Galaxy Globe",
    twistName: "Heal",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/1379dd334a16615a8731a3a4f97b932f.png~tplv-obj.webp",
    diamonds: 1500,
    description: "Herstelt een eliminatie.",
    aliases: ["heal"]
  },

  diamondpistol: {
    giftName: "Diamond Gun",
    twistName: "Single Survivor",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/651e705c26b704d03bc9c06d841808f1.png~tplv-obj.webp",
    diamonds: 5000,
    description: "Laat één speler over.",
    aliases: ["dp", "pistol"]
  },

  breaker: {
    giftName: "Train",
    twistName: "Immune Breaker",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/4227ed71f2c494b554f9cbe2147d4899~tplv-obj.webp",
    diamonds: 899,
    description: "Breekt immuniteit.",
    aliases: ["breaker"]
  }
};

const TWIST_KEYS = Object.entries(TWIST_MAP).map(([key, t]) => ({
  key,
  giftName: t.giftName,
  twistName: t.twistName,
  gift: t.giftName,
  description: t.description,
  aliases: [...t.aliases],
  icon: t.icon || EMPTY_AVATAR
}));

// ============================================================================
// INIT ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log("%c[BattleBox] Event Router Ready v5.1 (HARD RESET)", "color:#0fffd7;font-weight:bold;");

  // ------------------------------------------------------------------------
  // INITIAL SNAPSHOT
  // ------------------------------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);
    if (snap.arena) setArenaSnapshot(snap.arena);

    twistStore.setTwists(TWIST_KEYS.slice(0, 3));
  });

  // ------------------------------------------------------------------------
  // ARENA UPDATES
  // ------------------------------------------------------------------------
  socket.on("updateArena", (pkt) => {
    const norm = normalizeArena(pkt);
    if (norm) arenaStore.set(norm);
    document.dispatchEvent(new CustomEvent("arena:update", { detail: norm }));
  });

  // ------------------------------------------------------------------------
  // ROUND EVENTS (AUTO QUEUE RESET HERE)
  // ------------------------------------------------------------------------
  socket.on("round:start", (payload) => {
    // ⭐ ALWAYS reset twist queue at new round
    arenaTwistStore.resetAll();

    const total = (payload.duration || 0) * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "active",
      round: payload.round || 0,
      type: payload.type || "quarter",
      totalMs: total,
      endsAt,
      remainingMs: total
    });

    document.dispatchEvent(new CustomEvent("arena:roundStart", { detail: payload }));
  });

  socket.on("round:grace", (payload) => {
    // ⭐ reset queue on grace start (safety)
    arenaTwistStore.resetAll();

    const total = (payload.grace || 5) * 1000;
    const endsAt = Date.now() + total;

    arenaStore.set({
      status: "grace",
      round: payload.round || 0,
      type: payload.type || "quarter",
      totalMs: total,
      endsAt,
      remainingMs: total
    });

    document.dispatchEvent(new CustomEvent("arena:graceStart", { detail: payload }));
  });

  socket.on("round:end", () => {
    // ⭐ reset queue on round end (cleanup)
    arenaTwistStore.resetAll();

    arenaStore.set({
      status: "ended",
      totalMs: 0,
      endsAt: 0,
      remainingMs: 0
    });

    document.dispatchEvent(new CustomEvent("arena:roundEnd"));
  });

  // ========================================================================
  // ⭐⭐⭐ TWIST TAKEOVER — FULL PAYLOAD, NAME FIXES, CORRUPTION CHECK ⭐⭐⭐
  // ========================================================================
  socket.on("twist:takeover", (raw) => {
    // corruption guard
    if (!raw || !raw.type) {
      console.warn("[Twist] Invalid takeover payload – HARD RESET");
      arenaTwistStore.resetAll();
      return;
    }

    const payload = {
      type: raw.type || null,
      title: raw.title || "",

      by: raw.by || raw.sender || raw.senderName || null,
      byUsername: raw.byUsername || raw.senderUsername || null,
      byDisplayName: raw.byDisplayName || raw.senderDisplayName || null,
      senderName: raw.senderName || raw.by || null,

      targetId: raw.targetId || null,
      targetName: raw.targetName || null,
      targetIndex: Number.isFinite(raw.targetIndex) ? raw.targetIndex : null,

      victimIds: Array.isArray(raw.victimIds) ? raw.victimIds : [],
      victimNames: Array.isArray(raw.victimNames) ? raw.victimNames : [],
      victimIndices: (raw.victimIndices || []).map(i =>
        Number.isFinite(i) ? i : null
      ),

      survivorId: raw.survivorId || null,
      survivorName: raw.survivorName || null,
      survivorIndex: Number.isFinite(raw.survivorIndex)
        ? raw.survivorIndex
        : null,

      reverse: raw.reverse || false
    };

    arenaTwistStore.activate(payload);

    document.dispatchEvent(
      new CustomEvent("arena:twistTakeover", { detail: payload })
    );
  });

  // ========================================================================
  // ⭐ TWIST CLEAR (NOW A HARD SYNC POINT)
  // ========================================================================
  socket.on("twist:clear", () => {
    arenaTwistStore.clear();

    // ⭐ Critical safety → also kill old FX + galaxy
    if (arenaTwistStore.resetAll) {
      arenaTwistStore.resetAll();
    }

    document.dispatchEvent(new CustomEvent("arena:twistClear"));
  });

  // ========================================================================
  // TWIST COUNTDOWN
  // ========================================================================
  socket.on("twist:countdown", (raw) => {
    const payload = {
      type: "countdown",
      step: Number.isFinite(raw.step) ? raw.step : 3,

      by: raw.by || raw.senderName || null,
      byUsername: raw.byUsername || null,
      byDisplayName: raw.byDisplayName || null
    };

    arenaTwistStore.countdown(payload);

    document.dispatchEvent(
      new CustomEvent("arena:twistCountdown", { detail: payload })
    );
  });

  // ========================================================================
  // QUEUE UPDATE
  // ========================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  // ========================================================================
  // QUEUE EVENTS
  // ========================================================================
  socket.on("queueEvent", (evt) => {
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
        evt.reason ||
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

  // ========================================================================
  // HUD TICKER
  // ========================================================================
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // ========================================================================
  // LEGACY TWIST ROTATION
  // ========================================================================
  let twistIndex = 0;
  function rotateLegacyTwists() {
    const slice = TWIST_KEYS.slice(twistIndex, twistIndex + 3);
    if (slice.length < 3)
      slice.push(...TWIST_KEYS.slice(0, 3 - slice.length));

    twistStore.setTwists(slice);
    twistIndex = (twistIndex + 3) % TWIST_KEYS.length;
  }

  rotateLegacyTwists();
  setInterval(rotateLegacyTwists, 10000);

  // ========================================================================
  // DEBUG BRIDGE
  // ========================================================================
  window.bb = { socket, eventStore, arenaStore, arenaTwistStore, twistStore };
  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7");
}
