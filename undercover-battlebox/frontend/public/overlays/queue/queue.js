// ============================================================================
// queue.js — BattleBox Queue Overlay (3×5 COLUMN MODE • FIXED POSITIONS)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { queueStore } from "/overlays/shared/stores.js";

initEventRouter();

const grid = document.getElementById("queue-grid");

const EMPTY_AVATAR =
  "https://cdn.vectorstock.com/i/1000v/43/93/default-avatar-photo-placeholder-icon-grey-vector-38594393.jpg";

const TOTAL = 15;

// ------------------------------
// helper: trim long names
// ------------------------------
function trimName(str) {
  if (!str) return "";
  return str.length > 30 ? str.substring(0, 30) + "..." : str;
}

// ------------------------------
// helper: manually place card in grid
// ------------------------------
function applyGridPosition(card, index) {
  const column = Math.floor(index / 5) + 1;
  const row = (index % 5) + 1;

  card.style.gridColumn = column;
  card.style.gridRow = row;
}

// ------------------------------
// create cards & place correctly
// ------------------------------
const cards = Array.from({ length: TOTAL }, (_, i) => {
  const c = document.createElement("div");
  c.className = "bb-card empty-card";
  applyGridPosition(c, i);
  return c;
});

cards.forEach((c) => grid.appendChild(c));

// ------------------------------
// render loop
// ------------------------------
queueStore.subscribe((state) => {
  const entries = state.entries || [];
  const highlightUser = state.lastUpdatedId;

  for (let i = 0; i < TOTAL; i++) {
    const el = cards[i];
    const entry = entries[i];

    const pos = i + 1;

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

    el.className = "bb-card";

    if (entry.is_vip) el.classList.add("vip-glow");

    if (highlightUser && highlightUser === entry.username) {
      el.classList.add("card-update");
      setTimeout(() => el.classList.remove("card-update"), 650);
    }

    const avatar = entry.avatar_url || EMPTY_AVATAR;

    el.innerHTML = `
      <div class="pos-badge">${pos}</div>

      <div class="card-avatar" 
           style="background-image:url('${avatar}')"></div>

      <div class="card-info">
        <div class="name">${trimName(entry.display_name)}</div>
        <div class="user">@${entry.username}</div>
      </div>
    `;
  }
});
