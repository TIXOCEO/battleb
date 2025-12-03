// ============================================================================
// queue.js — Renders the 30-card BattleBox queue overlay
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { queueStore } from "/overlays/shared/stores.js";

// Start socket listeners
initEventRouter();

// DOM
const grid = document.getElementById("queue-grid");

// Pre-render 30 card containers
const cardEls = Array.from({ length: 30 }, () => {
  const div = document.createElement("div");
  div.className = "bb-card empty-card";
  return div;
});

cardEls.forEach((c) => grid.appendChild(c));

// Listen for queue updates
queueStore.subscribe((entries) => {
  for (let i = 0; i < 30; i++) {
    const el = cardEls[i];
    const entry = entries[i];

    if (!entry) {
      el.className = "bb-card empty-card";
      el.innerHTML = "";
      continue;
    }

    el.className = "bb-card";

    if (entry.is_vip) el.classList.add("vip-glow");

    const avatar = entry.avatar_url || "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

    el.innerHTML = `
      <div class="pos-badge">${entry.position}</div>

      <div class="card-avatar" style="background-image:url('${avatar}')"></div>

      <div style="margin-top:6px;">
        <div style="font-weight:700; font-size:14px;">${entry.display_name}</div>
        <div style="opacity:0.75; font-size:12px;">@${entry.username}</div>

        ${
          entry.priorityDelta > 0
            ? `<div style="color:var(--color-orange); font-size:11px; margin-top:3px;">+${entry.priorityDelta} bonus</div>`
            : ""
        }
      </div>
    `;
  }
});
