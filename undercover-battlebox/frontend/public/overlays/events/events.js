// ============================================================================
// events.js — BattleBox Events Overlay Renderer
// ============================================================================

import { initEventRouter } from "overlays/shared/event-router.js";
import { useEventStore } from "overlays/shared/stores.js";

// Initialize event router ONCE
initEventRouter();

// DOM
const root = document.getElementById("events-list");

// Subscribe to Zustand store
useEventStore.subscribe((state) => {
  const events = state.events || [];

  // Clear list
  root.innerHTML = "";

  // Re-render all events
  events.forEach((evt) => {
    const el = document.createElement("div");
    el.className = "bb-event-item";

    // Fade effect triggers later
    if (evt._fading) {
      el.classList.add("event-fade");
    }

    el.innerHTML = `
      <div class="event-icon ${evt.type}"></div>

      <div class="event-text">
        <div class="name">${evt.display_name}</div>
        <div class="user">@${evt.username}</div>
      </div>

      ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
    `;

    root.appendChild(el);

    // Schedule fade-out CSS class (already timed by event-router)
    setTimeout(() => {
      el.classList.add("event-fade");
    }, 500);
  });
});
