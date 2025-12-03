// ============================================================================
// events.js — FIXED VERSION
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

// Start event routing
initEventRouter();

const root = document.getElementById("events-list");

// Subscribe ONLY to events array
eventStore.subscribe(
  (state) => state.events,  // <-- select slice
  (events) => {
    root.innerHTML = "";

    events.forEach((evt) => {
      const el = document.createElement("div");
      el.className = "bb-event-item";

      el.innerHTML = `
        <div class="event-icon ${evt.type}"></div>

        <div class="event-text">
          <div class="name">${evt.display_name}</div>
          <div class="user">@${evt.username}</div>
        </div>

        ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
      `;

      root.appendChild(el);

      // Trigger fade-out
      setTimeout(() => {
        el.classList.add("event-fade");
      }, 4500);
    });
  }
);
