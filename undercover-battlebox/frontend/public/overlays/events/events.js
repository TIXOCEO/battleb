// ============================================================================
// events.js — ESPORTS EVENT PANEL — v2.0 FINAL (MATCHED TO NEW queueEvent FORMAT)
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const root = document.getElementById("events-list");
const MAX_EVENTS = 10;

// Subscribe ONLY to event list
eventStore.subscribe(
  (state) => state.events,
  (events) => {
    if (!Array.isArray(events)) return;

    // Keep only newest 10
    const sliced = events.slice(0, MAX_EVENTS);

    root.innerHTML = "";

    sliced.forEach((evt) => {
      const name = evt.display_name || "Onbekend";
      const username = evt.username || "";
      const type = evt.type || "join";
      const reason = evt.reason || "—";
      const avatar = evt.avatar_url || "";
      const vip = !!evt.is_vip;

      const el = document.createElement("div");
      el.className = "bb-event-item";

      el.innerHTML = `
        <div class="event-icon-wrapper">
          <img class="event-avatar" src="${avatar}" />
          <div class="event-type-icon ${type}"></div>
        </div>

        <div class="event-text">
          <div class="name">${truncate(name, 22)}</div>
          <div class="user">@${truncate(username, 20)}</div>
          <div class="reason">${reason}</div>
        </div>

        ${
          vip
            ? `<div class="event-vip"></div>`
            : ""
        }
      `;

      root.appendChild(el);

      // Fade-out animation
      setTimeout(() => {
        el.classList.add("event-fade");
      }, 5500);
    });
  }
);

// truncate helper
function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
