// ============================================================================
// events.js — BattleBox EVENTS OVERLAY v6.1 (NO FADE VERSION)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { eventStore } from "/overlays/shared/stores.js";

initEventRouter();

const root = document.getElementById("events-list");
const MAX_VISIBLE = 10;

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
  return !s ? "" : s.length > max ? s.slice(0, max - 3) + "..." : s;
}

let previousCount = 0;

function animateStackIfNewEvent(countNow) {
  if (countNow > previousCount) {
    root.style.transform = "translateY(-16px)";
    setTimeout(() => {
      root.style.transform = "translateY(0)";
    }, 40);
  }
  previousCount = countNow;
}

function render(list) {
  root.innerHTML = "";

  const events = list.slice(0, MAX_VISIBLE);

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
        <div class="reason">${truncate(evt.reason, 42)}</div>
      </div>

      ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
    `;

    root.appendChild(el);
  });

  animateStackIfNewEvent(events.length);
}

eventStore.subscribe((state) => {
  render(state.events);
});
