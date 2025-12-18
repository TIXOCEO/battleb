// ============================================================================
// event-router.js — BattleBox Event Brain v5.1 HARD-RESET EDITION (EXTENDED)
// PATCHED: TwistMessage bridge + twist:finish support (bomb hit + fallback UI)
// FULL TWIST PAYLOAD SYNC + QUEUE-SAFE + NAME FIXES + COUNTDOWN SUPPORT
// + BATTLELOG EVENT FEED (ARENA + TWISTS + ROUND + SNAPSHOT)
// + FIXED: Twist activation routing → arenaTwistStore (LITE MODE READY)
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
  "https://i.imgur.com/x6v5tkX.jpeg";

const QUEUE_EVENTS = new Set(["join", "leave", "promote", "demote"]);
let routerStarted = false;

// ============================================================================
// 🧠 NEW: remember last bomb sender (UI only, no gameplay impact)
// ============================================================================
let lastBombSender = null;

// ============================================================================
// NORMALIZER (arena)
// ============================================================================
function normalizeArena(pkt) {
  if (!pkt) return null;

  const hud = pkt.hud || pkt;
  const now = Date.now();

  const totalMs = hud.totalMs || 0;
  const remainingMs =
     typeof hud.remainingMs === "number"
       ? hud.remainingMs
       : Math.max(0, (hud.endsAt || 0) - now);

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
// LEGACY TWIST MAP (unchanged)
// ============================================================================
const TWIST_MAP = {
  galaxy: {
    giftName: "Galaxy",
    twistName: "Galaxy Twist",
    icon: "http://178.251.232.12/overlays/icons/galaxy.webp",
    diamonds: 1000,
    description: "Draait de ranking om!",
    aliases: ["galaxy", "gxy"]
  },

  moneygun: {
    giftName: "Money Gun",
    twistName: "Eliminatie",
    icon: "http://178.251.232.12/overlays/icons/moneygun.webp",
    diamonds: 500,
    description: "Markeert @target voor eliminatie.",
    aliases: ["moneygun", "mg"]
  },

  bomb: {
    giftName: "Space Dog",
    twistName: "Bomb",
    icon: "http://178.251.232.12/overlays/icons/spacedog.webp",
    diamonds: 2500,
    description: "Random BOOM, random speler eliminatie.",
    aliases: ["bomb"]
  },

  immune: {
    giftName: "Blooming Heart",
    twistName: "Immuniteit",
    icon: "http://178.251.232.12/overlays/icons/bloomingheart.webp",
    diamonds: 1599,
    description: "Beschermt @target tegen eliminatie.",
    aliases: ["immune", "save"]
  },

  heal: {
    giftName: "Galaxy Globe",
    twistName: "Heal",
    icon: "http://178.251.232.12/overlays/icons/galaxyglobe.webp",
    diamonds: 1500,
    description: "Herstelt @target van een eliminatie.",
    aliases: ["heal"]
  },

  diamondpistol: {
    giftName: "Diamond Gun",
    twistName: "Single Survivor",
    icon: "http://178.251.232.12/overlays/icons/diamondgun.webp",
    diamonds: 5000,
    description: "Alleen @target overleeft deze ronde!",
    aliases: ["dp", "pistol"]
  },

  breaker: {
    giftName: "Train",
    twistName: "Immune Breaker",
    icon: "http://178.251.232.12/overlays/icons/train.webp",
    diamonds: 899,
    description: "Breekt immuniteit (2x nodig).",
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
// BATTLELOG PUSHER
// ============================================================================
function pushBattleEvent(evt) {
  try {
    eventStore.pushEvent({
      timestamp: Date.now(),
      avatar_url: evt.avatar_url || EMPTY_AVATAR,
      is_vip: !!evt.is_vip,
      display_name: evt.display_name || evt.username || "Onbekend",
      username: evt.username || "unknown",
      reason: evt.reason || "",
      type: evt.type || "event"
    });
  } catch (err) {
    console.warn("[BattleLog] Failed to push event:", err, evt);
  }
}

// ============================================================================
// ✅ NEW: helpers for TwistMessage bridge
// - twistMessage.js luistert ALLEEN naar document event "twist:message"
// ============================================================================

function getArenaPlayerNameById(id) {
  if (!id) return null;
  const st = arenaStore.get();
  const p = Array.isArray(st.players)
    ? st.players.find(x => x?.id === id)
    : null;
  return p?.display_name || p?.username || null;
}

function dispatchTwistMessage(detail) {
  try {
    document.dispatchEvent(new CustomEvent("twist:message", { detail }));
  } catch (e) {
    console.warn("[TwistMessage] dispatch failed", e, detail);
  }
}

function bridgeTwistTakeoverToTwistMessage(p) {
  if (!p || !p.type) return;

  const type = (p.type || "").toLowerCase();

  const byDisplayName =
    p.byDisplayName ||
    p.by ||
    p.byUsername ||
    p.senderName ||
    p.sender ||
    "Onbekend";

  // 🧠 onthoud bomb sender voor finish-event
  if (type === "bomb") {
    lastBombSender = byDisplayName;
  }

  const targetName =
    p.targetName ||
    p.targetDisplayName ||
    (p.targetId ? getArenaPlayerNameById(p.targetId) : null) ||
    null;

  const survivorName =
    p.survivorName ||
    (p.survivorId ? getArenaPlayerNameById(p.survivorId) : null) ||
    null;

  dispatchTwistMessage({
    type,
    byDisplayName,
    targetName,
    survivorName,
    victimNames: p.victimNames || p.victims || []
  });
}

function bridgeTwistFinishToTwistMessage(finish) {
  if (!finish || !finish.type) return;

  const type = (finish.type || "").toLowerCase();

  const targetName =
    finish.targetName ||
    (finish.targetId ? getArenaPlayerNameById(finish.targetId) : null) ||
    null;

  // 🔧 FIX: gebruik bewaarde bomb-sender
  const byDisplayName =
    type === "bomb"
      ? lastBombSender || "Onbekend"
      : finish.byDisplayName ||
        finish.by ||
        finish.senderName ||
        "Onbekend";

  dispatchTwistMessage({
    type,
    byDisplayName,
    targetName
  });
}

// ============================================================================
// INIT ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();
  console.log(
    "%c[BattleBox] Event Router Ready v5.1 (HARD RESET) — PATCHED",
    "color:#0fffd7;font-weight:bold;"
  );

  // ------------------------------------------------------------------------
  // SNAPSHOT
  // ------------------------------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    applySnapshot(snap);

    if (snap.arena) {
      setArenaSnapshot(snap.arena);

      if (Array.isArray(snap.arena.players)) {
        snap.arena.players.forEach((p) => {
          pushBattleEvent({
            type: "arenaJoin",
            display_name: p.display_name || p.username,
            username: p.username,
            avatar_url: p.avatar_url,
            reason: "joint de arena."
          });
        });
      }
    }

    twistStore.setTwists(TWIST_KEYS);
  });

  // ------------------------------------------------------------------------
  // ARENA UPDATE
  // ------------------------------------------------------------------------
  socket.on("updateArena", (pkt) => {
    if (!pkt) return;

    const norm = normalizeArena(pkt);

    if (Array.isArray(pkt.players)) {
      arenaStore.set({ players: pkt.players });
    }

    if (norm) {
      arenaStore.set({
        round: norm.round,
        type: norm.type,
        status: norm.status,

        totalMs: norm.totalMs,
        endsAt: norm.endsAt,
        remainingMs: norm.remainingMs,

        roundCutoff: norm.roundCutoff,
        graceEnd: norm.graceEnd,

        settings: norm.settings ?? arenaStore.get().settings
      });
    }

    document.dispatchEvent(new CustomEvent("arena:update", { detail: norm }));
  });

  socket.on("twist:purchase", (data) => {
  document.dispatchEvent(
    new CustomEvent("twist:message", {
      detail: {
        title: `${data.byDisplayName} kocht een ${data.twist.toUpperCase()}`,
        subtitle: data.giftName,
        type: "purchase"
      }
    })
  );
});

  // ------------------------------------------------------------------------
  // ROUND EVENTS
  // ------------------------------------------------------------------------
  socket.on("round:start", (payload) => {
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

    pushBattleEvent({
      type: "round:start",
      display_name: "Ronde",
      username: "system",
      reason: `Ronde ${payload.round} gestart (${payload.type}).`
    });

    document.dispatchEvent(
      new CustomEvent("arena:roundStart", { detail: payload })
    );
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

    pushBattleEvent({
      type: "round:grace",
      display_name: "Grace",
      username: "system",
      reason: "Grace periode gestart."
    });

    document.dispatchEvent(
      new CustomEvent("arena:graceStart", { detail: payload })
    );
  });

  socket.on("round:end", () => {
    arenaStore.set({
      status: "ended",
      totalMs: 0,
      endsAt: 0,
      remainingMs: 0
    });

    pushBattleEvent({
      type: "round:end",
      display_name: "Ronde",
      username: "system",
      reason: "Ronde beëindigd."
    });

    document.dispatchEvent(new CustomEvent("arena:roundEnd"));
  });

  // ------------------------------------------------------------------------
  // ARENA PLAYER EVENTS
  // ------------------------------------------------------------------------
  socket.on("arena:join", (p) => {
    pushBattleEvent({
      type: "arenaJoin",
      display_name: p.display_name || p.username,
      username: p.username,
      avatar_url: p.avatar_url,
      reason: "joint de arena."
    });
  });

  socket.on("arena:leave", (p) => {
    pushBattleEvent({
      type: "arenaLeave",
      display_name: p.display_name || p.username,
      username: p.username,
      avatar_url: p.avatar_url,
      reason: "verlaat de arena."
    });
  });

  socket.on("arena:eliminated", (p) => {
    pushBattleEvent({
      type: "eliminated",
      display_name: p.display_name || p.username,
      username: p.username,
      avatar_url: p.avatar_url,
      reason: "is geëlimineerd."
    });
  });

  // ========================================================================
  // ⭐ TWIST EVENTS
  // ========================================================================
  socket.on("twist:takeover", (p) => {
    pushBattleEvent({
      type: `twist:${p.type}`,
      display_name: p.byDisplayName || p.by || p.byUsername || "Onbekend",
      username: p.byUsername || "unknown",
      avatar_url: p.avatar_url,
      reason: p.title || "Twist geactiveerd."
    });

    arenaTwistStore.activate({
      type: p.type,
      title: p.title,
      payload: p
    });

    bridgeTwistTakeoverToTwistMessage(p);
  });

  socket.on("twist:finish", (finish) => {
    bridgeTwistFinishToTwistMessage(finish);
  });

  // ========================================================================
  // QUEUE UPDATE
  // ========================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  socket.on("queueEvent", (evt) => {
    if (!evt || !QUEUE_EVENTS.has(evt.type)) return;

    const safeDisplay =
      evt.display_name?.trim() || evt.username?.trim() || "Onbekend";

    const safeUsername =
      evt.username?.trim() ||
      safeDisplay.toLowerCase().replace(/\s+/g, "");

    pushBattleEvent({
      type: evt.type,
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
  // DEBUG BRIDGE
  // ========================================================================
  window.bb = { socket, eventStore, arenaStore, arenaTwistStore, twistStore };
  console.log(
    "%c[BB DEBUG] Debug bridge active → window.bb",
    "color:#0fffd7"
  );
}
