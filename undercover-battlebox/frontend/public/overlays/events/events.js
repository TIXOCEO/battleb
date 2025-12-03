// ============================================================================
// events.js — BattleBox Events Overlay Renderer (Pure JS Store)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { eventStore } from "/overlays/shared/stores.js";

// Start socket listeners
initEventRouter();

const root = document.getElementById("events-list");

// Subscribe to event store
eventStore.subscribe((state) => {
  const events = state.events || [];

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

    // Fade-out animation
    setTimeout(() => {
      el.classList.add("event-fade");
    }, 4500);
  });
});
