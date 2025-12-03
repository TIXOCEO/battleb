// ============================================================================
// queue.js — Renders the 30-card BattleBox queue overlay
// ============================================================================

import { initEventRouter } from "../shared/event-router.js";
import { useQueueStore } from "../shared/stores.js";

// Init router ONCE
initEventRouter();

// DOM refs
const grid = document.getElementById("queue-grid");

// Pre-generate 30 card wrappers
const cardEls = Array.from({ length: 30 }, () => {
  const div = document.createElement("div");
  div.className = "bb-card empty-card";
  return div;
});

// Append cards to DOM
cardEls.forEach((el) => grid.appendChild(el));

// Subscribe to queue store
useQueueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlight = state.lastUpdatedId;

  // Loop over 30 card slots
  for (let i = 0; i < 30; i++) {
    const el = cardEls[i];
    const entry = entries[i];

    if (!entry) {
      el.className = "bb-card empty-card";
      el.innerHTML = "";
      continue;
    }

    // Base class
    el.className = "bb-card";

    // VIP?
    if (entry.is_vip) el.classList.add("vip-glow");

    // Highlight?
    if (highlight && entry.username === highlight) {
      el.classList.add("card-update");
      setTimeout(() => el.classList.remove("card-update"), 650);
    }

    // Render content
    el.innerHTML = `
      <div class="pos-badge">${entry.position}</div>

      <div class="card-avatar"
        style="background-image:url('${entry.avatar_url}')">
      </div>

      <div style="margin-top:6px;">
        <div style="font-weight:700; font-size:14px;">
          ${entry.display_name}
        </div>
        <div style="opacity:0.75; font-size:12px;">
          @${entry.username}
        </div>
        ${
          entry.priorityDelta > 0
            ? `<div style="color:var(--neon-orange); font-size:11px;margin-top:3px;">+${entry.priorityDelta} bonus</div>`
            : ""
        }
      </div>
    `;
  }
});
