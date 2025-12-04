// ============================================================================
// events.js — BattleBox EVENTS OVERLAY v4.0
// - Max 10 events visible
// - Newest on top
// - Smooth scroll animation
// - Flashy entrance animation
// - Fade-out + auto removal
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { eventStore } from "/overlays/shared/stores.js";

initEventRouter();

const root = document.getElementById("events-list");

const MAX_VISIBLE = 10;
const FADE_DELAY = 5500;
const REMOVE_DELAY = 600;

// ICON MAP
function getEventIcon(type) {
  switch (type) {
    case "join": return "▶";
    case "leave": return "◀";
    case "promote": return "＋";
    case "demote": return "－";
    default: return "▶";
  }
}

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

// ---------------------------------------------------------
// Smooth scroll logic
// ---------------------------------------------------------
let lastHeight = 0;

function refreshScroll() {
  const totalHeight = root.scrollHeight;
  const diff = totalHeight - lastHeight;

  if (diff > 0) {
    root.style.transform = `translateY(${-(diff)}px)`;
    setTimeout(() => {
      root.style.transform = "translateY(0)";
    }, 30);
  }

  lastHeight = totalHeight;
}

// ---------------------------------------------------------
// Render events
// ---------------------------------------------------------
function render(list) {
  if (!Array.isArray(list)) return;

  const events = list.slice(0, MAX_VISIBLE);

  root.innerHTML = "";

  events.forEach((evt) => {
    const el = document.createElement("div");
    el.className = "bb-event-item";

    const icon = getEventIcon(evt.type);
    const vip = evt.is_vip;

    el.innerHTML = `
      <div class="event-icon-wrapper">
        <div class="event-type-icon ${evt.type}">${icon}</div>
      </div>

      <div class="event-text">
        <div class="name">${truncate(evt.display_name, 22)}</div>
        <div class="reason">${truncate(evt.reason, 28)}</div>
      </div>

      ${vip ? `<div class="event-vip"></div>` : ""}
    `;

    root.appendChild(el);

    // Fade → remove
    setTimeout(() => el.classList.add("event-fade"), FADE_DELAY);
    setTimeout(() => el.remove(), FADE_DELAY + REMOVE_DELAY);
  });

  refreshScroll();
}

// ---------------------------------------------------------
// Subscribe
// ---------------------------------------------------------
eventStore.subscribe((state) => {
  render(state.events);
});
