// ============================================================================
// battlelog.js — BattleBox BattleLog v2.0
// 2 PAGES × 3 EVENTS • Twist aware • Arena/Queue events
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const root = document.getElementById("battlelog-pages");
const PAGE_SIZE = 3;
const TOTAL_PAGES = 2;

let currentPage = 0;

// ------------------------------------------------------------
// ICON MAPPER
// ------------------------------------------------------------
function iconFor(type) {
  switch (type) {
    case "join": return { cls: "icon-join", sym: "▶" };
    case "leave": return { cls: "icon-leave", sym: "◀" };
    case "promote": return { cls: "icon-promote", sym: "+" };
    case "demote": return { cls: "icon-demote", sym: "-" };

    case "arenaJoin": return { cls: "icon-arena", sym: "⭘" };
    case "arenaLeave": return { cls: "icon-elim", sym: "✖" };
    case "eliminated": return { cls: "icon-elim", sym: "✖" };

    case "twist": return { cls: "icon-twist", sym: "★" };

    default: return { cls: "icon-join", sym: "▶" };
  }
}

// ------------------------------------------------------------
// RENDER FUNCTION
// ------------------------------------------------------------
function render(events) {
  // Only show the newest 6 events
  const sliced = events.slice(0, PAGE_SIZE * TOTAL_PAGES);

  root.innerHTML = "";

  for (let p = 0; p < TOTAL_PAGES; p++) {
    const page = document.createElement("div");
    page.className = "battlelog-page";

    const start = p * PAGE_SIZE;
    const pageEvents = sliced.slice(start, start + PAGE_SIZE);

    pageEvents.forEach((evt) => {
      const item = document.createElement("div");
      item.className = "battlelog-item";

      const icon = iconFor(evt.type);

      item.innerHTML = `
        <div class="battlelog-icon ${icon.cls}">
          <span>${icon.sym}</span>
        </div>

        <div class="battlelog-text">
          <div class="battlelog-name">${evt.display_name}</div>
          <div class="battlelog-reason">${evt.reason}</div>
        </div>
      `;

      page.appendChild(item);
    });

    root.appendChild(page);
  }

  updatePage();
}

// ------------------------------------------------------------
// PAGE SWITCH
// ------------------------------------------------------------
function updatePage() {
  const x = currentPage * -50; // because width = 200% (two pages)
  root.style.transform = `translateX(${x}%)`;
}

// Auto-cycle
setInterval(() => {
  currentPage = (currentPage + 1) % TOTAL_PAGES;
  updatePage();
}, 3000);

// ------------------------------------------------------------
// SUBSCRIBE TO STORE
// ------------------------------------------------------------
eventStore.subscribe((state) => {
  render(state.events);
});
