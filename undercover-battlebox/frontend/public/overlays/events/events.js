// ============================================================================
// events.js — BattleBox Events Overlay Renderer (ESPORTS V3)
// ============================================================================

import { useEventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

// Start router once
initEventRouter();

const root = document.getElementById("events-list");

// Zustand subscribe
useEventStore.subscribe((state) => {
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

    // Fade-out effect after X seconds (store handles deletion)
    setTimeout(() => item.classList.add("event-fade"), 4500);
  });
});
