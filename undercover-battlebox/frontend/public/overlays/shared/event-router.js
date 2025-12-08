// ============================================================================
// event-router.js — BattleBox Event Brain v4.5 FINAL (PATCHED + TWIST OVERLAY RESTORE)
// FULL PAYLOAD NORMALIZATION + COUNTDOWN + TWIST QUEUE v7.4 SUPPORT
// INCLUDING LEGACY TWIST MAP + ROTATION FOR OVERLAYS
// ============================================================================

import { getSocket } from "/overlays/shared/socket.js";
import {
  queueStore,
  eventStore,
  tickerStore,
  twistStore,      // ★ required for twist overlay restore
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
// NORMALIZER — arena updates
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
// ⭐ LEGACY TWIST MAP RESTORED (from v1.6)
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

// Legacy → array of mapped twist objects
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

  console.log(
    "%c[BattleBox] Event Router Ready (v4.5 + Twist Map Restore)",
    "color:#0fffd7;font-weight:bold;"
  );

  // ------------------------------------------------------------------------
  // 1) INITIAL SNAPSHOT
  // ------------------------------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    console.log("[DEBUG] Initial snapshot:", snap);

    applySnapshot(snap);

    if (snap.arena) setArenaSnapshot(snap.arena);

    // ★ Legacy twist display — show static twist list immediately
    twistStore.setTwists(TWIST_KEYS.slice(0, 3));
  });

  // ------------------------------------------------------------------------
  // 2) LIVE ARENA UPDATES
  // ------------------------------------------------------------------------
  socket.on("updateArena", (pkt) => {
    const norm = normalizeArena(pkt);
    if (norm) arenaStore.set(norm);

    document.dispatchEvent(new CustomEvent("arena:update", { detail: norm }));
  });

  // ------------------------------------------------------------------------
  // 3) ROUND EVENTS
  // ------------------------------------------------------------------------
  socket.on("round:start", (payload) => {
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
    window.dispatchEvent(new CustomEvent("round:start", { detail: payload }));
  });

  socket.on("round:grace", (payload) => {
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
    window.dispatchEvent(new CustomEvent("round:grace", { detail: payload }));
  });

  socket.on("round:end", () => {
    arenaStore.set({
      status: "ended",
      totalMs: 0,
      endsAt: 0,
      remainingMs: 0
    });

    document.dispatchEvent(new CustomEvent("arena:roundEnd"));
    window.dispatchEvent(new CustomEvent("round:end"));
  });

  // ------------------------------------------------------------------------
  // 4) TWIST TAKEOVER — ARENA TWIST ENGINE
  // ------------------------------------------------------------------------
  socket.on("twist:takeover", (raw) => {
    const payload = {
      type: raw.type || null,
      title: raw.title || "",
      targetId: raw.targetId || null,
      targetName: raw.targetName || null,
      targetIndex: Number.isFinite(raw.targetIndex) ? raw.targetIndex : null,
      victimIds: Array.isArray(raw.victimIds) ? raw.victimIds : [],
      victimNames: Array.isArray(raw.victimNames) ? raw.victimNames : [],
      victimIndices: (raw.victimIndices || []).map(i => Number.isFinite(i) ? i : null),
      survivorId: raw.survivorId || null,
      survivorName: raw.survivorName || null,
      survivorIndex: Number.isFinite(raw.survivorIndex) ? raw.survivorIndex : null,
      reverse: raw.reverse || false
    };

    arenaTwistStore.activate(payload);
    document.dispatchEvent(new CustomEvent("arena:twistTakeover", { detail: payload }));
  });

  // ------------------------------------------------------------------------
  // 5) TWIST CLEAR
  // ------------------------------------------------------------------------
  socket.on("twist:clear", () => {
    arenaTwistStore.clear();
    document.dispatchEvent(new CustomEvent("arena:twistClear"));
  });

  // ------------------------------------------------------------------------
  // 6) TWIST COUNTDOWN
  // ------------------------------------------------------------------------
  socket.on("twist:countdown", (raw) => {
    const payload = {
      type: "countdown",
      step: Number.isFinite(raw.step) ? raw.step : 3,
      by: raw.by || ""
    };

    arenaTwistStore.countdown(payload);
    document.dispatchEvent(new CustomEvent("arena:twistCountdown", { detail: payload }));
  });

  // ------------------------------------------------------------------------
  // 7) QUEUE UPDATE
  // ------------------------------------------------------------------------
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  // ------------------------------------------------------------------------
  // 8) QUEUE EVENTS
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // 9) HUD TICKER
  // ------------------------------------------------------------------------
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });

  // ------------------------------------------------------------------------
  // 10) LEGACY TWIST ROTATION (3 items → overlay shows 2)
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // 11) DEBUG BRIDGE
  // ------------------------------------------------------------------------
  window.bb = { socket, eventStore, arenaStore, arenaTwistStore, twistStore };
  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7");
}
