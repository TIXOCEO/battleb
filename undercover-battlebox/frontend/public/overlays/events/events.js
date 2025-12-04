// ============================================================================
// events.js — FULL ESPORTS STYLE — 10 EVENTS — FINAL BUILD
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const root = document.getElementById("events-list");
const MAX_EVENTS = 10;

eventStore.subscribe(
  (state) => state.events,
  (events) => {
    if (!Array.isArray(events)) return;

    // Limit to newest 10
    const sliced = events.slice(0, MAX_EVENTS);

    root.innerHTML = "";

    sliced.forEach((evt) => {
      const name = evt.display_name || "Onbekend";
      const username = evt.username || "";
      const type = evt.type || "join";
      const reason = evt.reason || evt.text || "—";

      const el = document.createElement("div");
      el.className = "bb-event-item";

      el.innerHTML = `
        <div class="event-icon ${type}"></div>

        <div class="event-text">
          <div class="name">${truncate(name, 24)}</div>
          <div class="user">@${username}</div>
          <div class="reason">${reason}</div>
        </div>

        ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
      `;

      root.appendChild(el);

      // Fade-out animation after 6 sec
      setTimeout(() => {
        el.classList.add("event-fade");
      }, 6000);
    });
  }
);

// truncate long names
function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}
