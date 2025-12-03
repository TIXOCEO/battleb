// ============================================================================
// events.js — FINAL SNAPSHOT SAFE VERSION
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

// Start event routing
initEventRouter();

const root = document.getElementById("events-list");

// Subscribe to events only
eventStore.subscribe(
  (state) => state.events,
  (events) => {
    if (!Array.isArray(events)) return;
    root.innerHTML = "";

    events.forEach((evt) => {
      const el = document.createElement("div");
      el.className = "bb-event-item";

      const name = evt.display_name || "Onbekend";
      const username = evt.username || "";
      const type = evt.type || "join";

      el.innerHTML = `
        <div class="event-icon ${type}"></div>

        <div class="event-text">
          <div class="name">${name}</div>
          <div class="user">@${username}</div>
        </div>

        ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
      `;

      root.appendChild(el);

      // Fade-out animation
      setTimeout(() => {
        el.classList.add("event-fade");
      }, 4500);
    });
  }
);
