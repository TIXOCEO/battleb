// ============================================================================
// queue.js — BattleBox Queue Overlay (ESPORTS MODE 3×5) — FINAL SNAPSHOT EDITION
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { queueStore } from "/overlays/shared/stores.js";

initEventRouter();

const grid = document.getElementById("queue-grid");

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

// 15 cards (3 columns × 5 rows)
const TOTAL = 15;

// Pre-create cards
const cards = Array.from({ length: TOTAL }, () => {
  const c = document.createElement("div");
  c.className = "bb-card empty-card";
  return c;
});

cards.forEach((c) => grid.appendChild(c));

function indexToPosition(i) {
  return i + 1;
}

queueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlightUser = state.lastUpdatedId;

  for (let i = 0; i < TOTAL; i++) {
    const el = cards[i];
    const entry = entries[i];

    const pos = indexToPosition(i);

    // FREE SPOT
    if (!entry) {
      el.className = "bb-card empty-card";
      el.innerHTML = `
        <div class="pos-badge">${pos}</div>

        <div class="card-avatar" 
             style="background-image:url('${EMPTY_AVATAR}')"></div>

        <div class="card-info">
          <div class="name">VRIJ</div>
          <div class="user">&nbsp;</div>
        </div>
      `;
      continue;
    }

    // FILLED SPOT
    el.className = "bb-card";

    // VIP
    if (entry.is_vip) el.classList.add("vip-glow");

    // Highlight
    if (highlightUser && highlightUser === entry.username) {
      el.classList.add("card-update");
      setTimeout(() => el.classList.remove("card-update"), 650);
    }

    // 🔥 PATCH — avatar_url fallback
    const avatar = entry.avatar_url || EMPTY_AVATAR;

    el.innerHTML = `
      <div class="pos-badge">${pos}</div>

      <div class="card-avatar" 
           style="background-image:url('${avatar}')">
      </div>

      <div class="card-info">
        <div class="name">${entry.display_name || "?"}</div>
        <div class="user">@${entry.username || ""}</div>
      </div>
    `;
  }
});
