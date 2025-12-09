// ============================================================================
// arena-queue.js — Mini Queue Renderer for Arena Scene
// ============================================================================

import { queueStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const list = document.getElementById("arena-queue-list");
const LIMIT = 15;

// HELPER: trim displayname
const trim = (s) =>
  !s ? "" : s.length > 18 ? s.substring(0, 18) + "…" : s;

// RENDER QUEUE
queueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlightId = state.lastUpdatedId;

  list.innerHTML = "";

  for (let i = 0; i < LIMIT; i++) {
    const item = entries[i];
    const pos = i + 1;

    if (!item) {
      list.innerHTML += `
        <div class="queue-entry empty">
          ${pos}. — 
        </div>
      `;
      continue;
    }

    const vip = item.is_vip ? " [VIP]" : "";
    const highlight = highlightId === item.username ? "highlight" : "";

    list.innerHTML += `
      <div class="queue-entry ${item.is_vip ? "vip" : ""} ${highlight}">
        <div>${pos}. ${trim(item.display_name)}${vip}</div>
        <div class="queue-user">@${item.username}</div>
      </div>
    `;
  }
});
