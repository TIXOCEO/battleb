// ============================================================================
// battlelog.js — BattleBox BattleLog Carousel v2.1
// 2 pages • 3 items per page • auto-rotate
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";

const root = document.getElementById("battlelog-list");
const container = document.getElementById("battlelog-container");

const ITEMS_PER_PAGE = 3;
const AUTO_ROTATE_MS = 4000;

let currentPage = 0;
let autoTimer = null;

// ICONS
function getEventIcon(type) {
  switch (type) {
    case "join": return "▶";
    case "leave": return "◀";
    case "promote": return "↑";
    case "demote": return "↓";
    case "bomb": return "💣";
    case "moneygun": return "💵";
    case "diamond": return "💎";
    case "galaxy": return "🌌";
    case "heal": return "✨";
    case "immune": return "🛡️";
    case "breaker": return "⚡";
    case "eliminate": return "✖";
    default: return "▶";
  }
}

function buildPage(events) {
  root.innerHTML = "";

  events.forEach(evt => {
    const el = document.createElement("div");
    el.className = "battlelog-item";

    el.innerHTML = `
      <div class="battlelog-icon">${getEventIcon(evt.type)}</div>

      <div class="battlelog-text">
        <div class="name">${evt.display_name}</div>
        <div class="reason">${evt.reason || ""}</div>
      </div>

      ${evt.is_vip ? `<div class="battlelog-vip"></div>` : ""}
    `;

    root.appendChild(el);
  });
}

function showPage(pageIndex, events) {
  const totalPages = Math.ceil(events.length / ITEMS_PER_PAGE);
  if (pageIndex >= totalPages) pageIndex = 0;

  const start = pageIndex * ITEMS_PER_PAGE;
  const slice = events.slice(start, start + ITEMS_PER_PAGE);

  // Exit animation
  root.classList.add("page-exit");
  setTimeout(() => {
    root.classList.remove("page-exit");

    // Enter transition
    root.classList.add("page-enter");
    buildPage(slice);

    requestAnimationFrame(() => {
      root.classList.add("page-enter-active");
    });

    setTimeout(() => {
      root.classList.remove("page-enter", "page-enter-active");
    }, 450);
  }, 350);

  currentPage = pageIndex;
}

function resetAuto(events) {
  if (autoTimer) clearInterval(autoTimer);

  autoTimer = setInterval(() => {
    showPage(currentPage + 1, events);
  }, AUTO_ROTATE_MS);
}

eventStore.subscribe(state => {
  const events = state.events;

  // Always show page 0 first when new event arrives
  currentPage = 0;
  showPage(0, events);
  resetAuto(events);
});
