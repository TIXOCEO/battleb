// ============================================================================
// event-router.js — BattleBox Event Brain v5.1 FIXED POPUP EDITION
// ============================================================================
// ✔ Twist popup werkt ALTIJD vanuit backend
// ✔ Universele payload normalizer voor twistTakeover
// ✔ Guaranteed dispatch naar twistMessage.js
// ✔ Verwijderd: race conditions tijdens arena updates
// ✔ Verbeterde debug logs
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

const EMPTY_AVATAR = "https://i.imgur.com/x6v5tkX.jpeg";
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
  galaxy: { giftName: "Galaxy", twistName: "Galaxy Twist",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/79a02148079526539f7599150da9fd28.png~tplv-obj.webp",
    diamonds: 1000, description: "Reverse ranking!", aliases: ["galaxy", "gxy"]
  },

  moneygun: {
    giftName: "Money Gun", twistName: "Eliminatie",
    icon: "https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/e0589e95a2b41970f0f30f6202f5fce6~tplv-obj.webp",
    diamonds: 500, description: "Markeert target eliminatie.", aliases: ["moneygun","mg"]
  },

  bomb: {
    giftName: "Space Dog", twistName: "Bomb",
    icon: "https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/9154160eb6726193bc51f5007d5853fa.png~tplv-obj.webp",
    diamonds: 2500, description: "Random BOOM.", aliases: ["bomb"]
  },

  immune: {
    giftName: "Blooming Heart", twistName: "Immuniteit",
    icon:"https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/ff5453b7569d482c873163ce4b1fb703.png~tplv-obj.webp",
    diamonds: 1599, description: "Beschermt tegen eliminatie.", aliases: ["immune","save"]
  },

  heal: {
    giftName: "Galaxy Globe", twistName: "Heal",
    icon:"https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/1379dd334a16615a8731a3a4f97b932f.png~tplv-obj.webp",
    diamonds: 1500, description: "Herstelt een eliminatie.", aliases: ["heal"]
  },

  diamondpistol: {
    giftName: "Diamond Gun", twistName: "Single Survivor",
    icon:"https://p16-webcast.tiktokcdn.com/img/alisg/webcast-sg/resource/651e705c26b704d03bc9c06d841808f1.png~tplv-obj.webp",
    diamonds: 5000, description: "Laat één speler over.", aliases: ["dp","pistol"]
  },

  breaker: {
    giftName: "Train", twistName: "Immune Breaker",
    icon:"https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/4227ed71f2c494b554f9cbe2147d4899~tplv-obj.webp",
    diamonds: 899, description: "Breekt immuniteit.", aliases: ["breaker"]
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
    console.warn("[BattleLog] Failed to push:", err, evt);
  }
}

// ============================================================================
// INIT ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();
  console.log("%c[BattleBox] Event Router Ready FIXED", "color:#0fffd7;font-weight:bold;");

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


  // ============================================================================
  // ⭐⭐⭐ TWIST PAYLOAD NORMALIZER
  // ============================================================================
  function normalizeTwistPayload(p) {
    if (!p) return {};

    return {
      type: p.type,
      byDisplayName: p.byDisplayName || p.byUsername || p.senderName || "Onbekend",
      byUsername: p.byUsername || null,

      targetDisplayName: p.targetDisplayName || null,
      targetUsername: p.targetUsername || null,

      victimNames: Array.isArray(p.victimNames) ? p.victimNames : [],
      survivorName: p.survivorName || null,

      avatar_url: p.avatar_url || EMPTY_AVATAR
    };
  }

  function twistReason(payload) {
    const sender = payload.byDisplayName || "Onbekend";
    const target = payload.targetDisplayName || payload.targetUsername || null;
    const victims = payload.victimNames?.length
      ? payload.victimNames.map(x => `@${x}`).join(", ")
      : null;
    const survivor = payload.survivorName;

    switch (payload.type) {
      case "moneygun":
        return target
          ? `${sender} markeert @${target} voor ELIMINATIE!`
          : `${sender} gebruikt MoneyGun!`;

      case "immune":
        return target
          ? `${sender} geeft @${target} IMMUNITEIT!`
          : `${sender} deelt immuniteit uit!`;

      case "heal":
        return target
          ? `${sender} herstelt @${target}!`
          : `${sender} voert een HEAL uit!`;

      case "bomb":
        return victims
          ? `${sender} gooit een BOM! Slachtoffer: ${victims}!`
          : `${sender} laat een BOM ontploffen!`;

      case "galaxy":
        return `${sender} draait de HELE ranking om! Chaos!`;

      case "breaker":
        return target
          ? `${sender} BREKT de immuniteit van @${target}!`
          : `${sender} gebruikt een Immunity Breaker!`;

      case "diamondpistol":
      case "diamond":
        return survivor
          ? `${sender} vuurt de DIAMOND GUN! @${survivor} overleeft — de rest ligt eruit!`
          : `${sender} gebruikt de Diamond Gun!`;

      default:
        return `${sender} activeert een twist.`;
    }
  }



  // ============================================================================
  // ⭐⭐⭐ FIX #1 — TWIST TAKEOVER → guaranteed popup dispatch
  // ============================================================================
  socket.on("arena:twistTakeover", (raw) => {
    const p = normalizeTwistPayload(raw);

    console.log("%c[TWIST ROUTER] TAKEOVER RAW:", "color:#ff0", raw);
    console.log("%c[TWIST ROUTER] TAKEOVER NORMALIZED:", "color:#0ff", p);

    const reason = twistReason(p);

    // → Battlelog
    pushBattleEvent({
      type: `twist:${p.type}`,
      display_name: p.byDisplayName,
      username: p.byUsername || "unknown",
      avatar_url: p.avatar_url,
      reason
    });

    // → Activate twist visual engine
    arenaTwistStore.activate({
      type: p.type,
      title: reason,
      payload: p
    });

    // → ⭐ POPUP: always dispatched AFTER state settles
    setTimeout(() => {
      console.log("%c[TWIST ROUTER] Dispatch twist:message", "color:#0f0;font-weight:bold;", p);
      document.dispatchEvent(new CustomEvent("twist:message", { detail: p }));
    }, 25);
  });



  // ============================================================================
  // ⭐⭐⭐ FIX #2 — COUNTDOWN
  // ============================================================================
  socket.on("arena:twistCountdown", (p) => {
    pushBattleEvent({
      type: "twist:countdown",
      display_name: p.byDisplayName || "Twist",
      username: p.byUsername || "unknown",
      reason: `Countdown ${p.step}…`
    });

    arenaTwistStore.countdown(p);
  });



  // ============================================================================
  // ⭐⭐⭐ FIX #3 — CLEAR
  // ============================================================================
  socket.on("arena:twistClear", () => {
    pushBattleEvent({
      type: "twist:clear",
      display_name: "System",
      username: "system",
      reason: "Twist-effect beëindigd."
    });

    arenaTwistStore.clear();
  });



  // ============================================================================
  // QUEUE UPDATE
  // ============================================================================
  socket.on("updateQueue", (packet) => {
    if (!packet || !Array.isArray(packet.entries)) return;
    queueStore.setQueue(packet.entries);
  });

  socket.on("queueEvent", (evt) => {
    if (!evt || !QUEUE_EVENTS.has(evt.type)) return;

    const safeDisplay = evt.display_name || evt.username || "Onbekend";
    const safeUsername = evt.username || safeDisplay.toLowerCase().replace(/\s+/g, "");

    pushBattleEvent({
      type: evt.type,
      display_name: safeDisplay,
      username: safeUsername,
      avatar_url: evt.avatar_url || EMPTY_AVATAR,
      is_vip: !!evt.is_vip,
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



  // ============================================================================
  // HUD TICKER
  // ============================================================================
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });



  // ============================================================================
  // LEGACY TWIST ROTATION
  // ============================================================================
  let twistIndex = 0;
  function rotateLegacyTwists() {
    const slice = TWIST_KEYS.slice(0, 3);
    twistStore.setTwists(slice);
    twistIndex = (twistIndex + 3) % TWIST_KEYS.length;
  }

  rotateLegacyTwists();
  setInterval(rotateLegacyTwists, 10000);


  // ============================================================================
  // DEBUG BRIDGE
  // ============================================================================
  window.bb = { socket, eventStore, arenaStore, arenaTwistStore, twistStore };
  console.log("%c[BB DEBUG] Debug bridge active → window.bb", "color:#0fffd7");
}
