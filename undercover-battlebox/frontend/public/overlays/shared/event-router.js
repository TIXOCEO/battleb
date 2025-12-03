// ============================================================================
// event-router.js — BattleBox Overlay Event Brain v1.3 (SNAPSHOT EDITION)
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

// ============================================================================
// TWIST MAP
// ============================================================================
const TWIST_MAP = {
  galaxy: { giftName: "Galaxy", diamonds: 1000, description: "Keert ranking om.", aliases: ["galaxy","gxy"] },
  moneygun: { giftName: "Money Gun", diamonds: 500, description: "Markeert speler.", aliases: ["moneygun","mg"] },
  bomb: { giftName: "Bomb", diamonds: 2500, description: "Random markering.", aliases: ["bomb"] },
  immune: { giftName: "Immune", diamonds: 1599, description: "Beschermt.", aliases: ["immune","save"] },
  heal: { giftName: "Heal", diamonds: 1500, description: "Verwijdert markering.", aliases: ["heal"] },
  diamondpistol: { giftName: "Diamond Gun", diamonds: 5000, description: "1 speler overleeft.", aliases: ["dp","pistol"] },
  breaker: { giftName: "Breaker", diamonds: 899, description: "Crackt immune.", aliases: ["breaker"] },
};

const twistKeys = Object.entries(TWIST_MAP).map(([key, def]) => ({
  key,
  name: def.giftName,
  gift: def.giftName,
  diamonds: def.diamonds,
  description: def.description,
  aliases: [...def.aliases],
  icon: EMPTY_AVATAR
}));

// ============================================================================
// MAIN ROUTER
// ============================================================================
export async function initEventRouter() {
  if (routerStarted) return;
  routerStarted = true;

  const socket = await getSocket();

  console.log("%c[BattleBox] Event Router Ready", "color:#0fffd7;font-weight:bold;");

  // -------------------------------------------------------------------------
  // SNAPSHOT (NEW!)
  // -------------------------------------------------------------------------
  socket.on("overlayInitialSnapshot", (snap) => {
    console.log("%c[BattleBox] SNAPSHOT ontvangen", "color:#0fffd7;font-weight:bold;");
    applySnapshot(snap);
  });

  // -------------------------------------------------------------------------
  // updateQueue → only first 15 slots
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // queueEvent
  // -------------------------------------------------------------------------
  socket.on("queueEvent", (evt) => {
    if (!evt || !evt.type) return;

    evt.display_name = evt.display_name || "Onbekend";
    evt.username = evt.username || "";
    evt.reason = evt.reason || "";

    eventStore.pushEvent(evt);

    if (evt.username) {
      queueStore.highlightCard(evt.username);
      setTimeout(() => queueStore.clearHighlight(), 900);
    }

    setTimeout(() => eventStore.fadeOutEvent(evt.timestamp), EVENT_LIFETIME_MS);
  });

  // -------------------------------------------------------------------------
  // Twist rotation
  // -------------------------------------------------------------------------
  let twistIndex = 0;

  function rotateTwists() {
    const slice = twistKeys.slice(twistIndex, twistIndex + 3);
    if (slice.length < 3) slice.push(...twistKeys.slice(0, 3 - slice.length));

    twistStore.setTwists(slice);
    twistIndex = (twistIndex + 3) % twistKeys.length;
  }

  rotateTwists();
  setInterval(rotateTwists, TWIST_ROTATION_MS);

  // -------------------------------------------------------------------------
  // Ticker
  // -------------------------------------------------------------------------
  socket.on("hudTickerUpdate", (text) => {
    tickerStore.setText(text || "");
  });
}
