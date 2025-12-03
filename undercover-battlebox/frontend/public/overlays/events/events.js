// ============================================================================
// events.js — BattleBox Events Overlay Renderer
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

// Start event routing (receives queueEvent)
initEventRouter();

const root = document.getElementById("events-list");

// Subscribe to event store
eventStore.subscribe((events) => {
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

    // Trigger fade-out after a few seconds
    setTimeout(() => {
      el.classList.add("event-fade");
    }, 4500);
  });
});
