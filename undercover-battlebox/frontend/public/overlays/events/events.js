// ============================================================================
// events.js — BattleBox EVENTS OVERLAY v5.0 FINAL
// ============================================================================
// - Newest events on top
// - Max 10 visible
// - Smooth push-down stack animation
// - Flashy entrance for each event
// - Fade-out via store (not DOM removal)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { eventStore } from "/overlays/shared/stores.js";

initEventRouter();

const root = document.getElementById("events-list");

const MAX_VISIBLE = 10;

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
  return s.length > max ? s.slice(0, max - 3) + "...";
}

// ---------------------------------------------------------
// Stack push animation (smooth downward shift)
// ---------------------------------------------------------
let previousCount = 0;

function animateStackIfNewEvent(countNow) {
  if (countNow > previousCount) {
    root.style.transform = "translateY(-22px)";
    setTimeout(() => {
      root.style.transform = "translateY(0)";
    }, 30);
  }
  previousCount = countNow;
}

// ---------------------------------------------------------
// Render event list
// ---------------------------------------------------------
function render(list) {
  const events = list.slice(0, MAX_VISIBLE);

  root.innerHTML = "";

  events.forEach((evt) => {
    const el = document.createElement("div");
    el.className = "bb-event-item";

    const icon = getEventIcon(evt.type);

    el.innerHTML = `
      <div class="event-icon-wrapper">
        <div class="event-type-icon ${evt.type}">${icon}</div>
      </div>

      <div class="event-text">
        <div class="name">${truncate(evt.display_name, 22)}</div>
        <div class="reason">${truncate(evt.reason, 34)}</div>
      </div>

      ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
    `;

    if (evt._fade) el.classList.add("event-fade");

    root.appendChild(el);
  });

  animateStackIfNewEvent(events.length);
}

// ---------------------------------------------------------
// Subscribe to eventStore
// ---------------------------------------------------------
eventStore.subscribe((state) => {
  render(state.events);
});
