// ============================================================================
// events.js — BattleBox Events Overlay Renderer (ESPORTS V3 FIXED)
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

// Start router once
initEventRouter();

const root = document.getElementById("events-list");

// Zustand subscribe
eventStore.subscribe((state) => {
  const events = state.events || [];

  root.innerHTML = "";

  events.forEach((evt) => {
    const item = document.createElement("div");
    item.className = "bb-event-item";

    item.innerHTML = `
      <div class="event-icon ${evt.type}"></div>

      <div class="event-text">
        <div class="name">${evt.display_name}</div>
        <div class="user">@${evt.username}</div>
      </div>

      ${evt.is_vip ? `<div class="event-vip"></div>` : ""}
    `;

    root.appendChild(item);

    // Fade-out CSS animation
    setTimeout(() => item.classList.add("event-fade"), 4500);
  });
});
