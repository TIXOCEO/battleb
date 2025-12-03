// ============================================================================
// queue.js — BattleBox Queue Overlay (ESPORTS V3)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { useQueueStore } from "/overlays/shared/stores.js";

// Start socket + event listeners once
initEventRouter();

// DOM target
const grid = document.getElementById("queue-grid");

// Pre-render 30 static card elements
const cardEls = Array.from({ length: 30 }, () => {
  const el = document.createElement("div");
  el.className = "bb-card empty-card";
  return el;
});

// Append cards into the 1200px panel grid
cardEls.forEach((c) => grid.appendChild(c));

// Subscribe to Zustand queue store
useQueueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlightUser = state.lastUpdatedId;

  for (let i = 0; i < 30; i++) {
    const el = cardEls[i];
    const entry = entries[i];

    if (!entry) {
      // Empty slot
      el.className = "bb-card empty-card";
      el.innerHTML = "";
      continue;
    }

    // Base styling
    el.className = "bb-card";

    // VIP effect
    if (entry.is_vip) {
      el.classList.add("vip-glow");
    }

    // Highlight flash animation
    if (highlightUser && entry.username === highlightUser) {
      el.classList.add("card-update");
      setTimeout(() => el.classList.remove("card-update"), 650);
    }

    const avatar =
      entry.avatar_url ||
      "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

    // Render card content
    el.innerHTML = `
      <div class="pos-badge">${entry.position}</div>

      <div class="card-avatar"
        style="background-image:url('${avatar}')">
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
