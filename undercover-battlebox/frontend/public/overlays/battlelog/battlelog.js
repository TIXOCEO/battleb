// ============================================================================
// battlelog.js — BattleBox BattleLog v2.2 (PATCHED FOR LIVE CYCLING)
// 2 PAGES × 3 EVENTS • Twist aware • Arena-aware • Queue-aware
// Fully patched for extended event-router.js
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const root = document.getElementById("battlelog-pages");
const PAGE_SIZE = 3;
const TOTAL_PAGES = 2;

let currentPage = 0;

// ------------------------------------------------------------
// SAFETY HELPERS
// ------------------------------------------------------------
function safe(text) {
  return text ?? "";
}

function truncate(text, max = 42) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

// ------------------------------------------------------------
// ICON MAPPER — supports twist:xxx, arena, queue
// ------------------------------------------------------------
function iconFor(type) {
  if (!type) return { cls: "icon-default", sym: "▶" };

  // Twist types always start with twist:
  if (type.startsWith("twist:")) return { cls: "icon-twist", sym: "★" };

  switch (type) {
    case "join": return { cls: "icon-join", sym: "▶" };
    case "leave": return { cls: "icon-leave", sym: "◀" };
    case "promote": return { cls: "icon-promote", sym: "+" };
    case "demote": return { cls: "icon-demote", sym: "-" };

    case "arenaJoin": return { cls: "icon-arena", sym: "⭘" };
    case "arenaLeave": return { cls: "icon-arena", sym: "◁" };
    case "eliminated": return { cls: "icon-elim", sym: "✖" };

    case "round:start": return { cls: "icon-round", sym: "⏵" };
    case "round:grace": return { cls: "icon-round", sym: "⏳" };
    case "round:end": return { cls: "icon-round", sym: "⏹" };

    default:
      return { cls: "icon-default", sym: "▶" };
  }
}

// ------------------------------------------------------------
// RENDER FUNCTION
// ------------------------------------------------------------
function render(events) {
  if (!Array.isArray(events)) return;

  // PATCH ✔ take the *newest* 6 entries, newest first
  const sliced = events.slice(-PAGE_SIZE * TOTAL_PAGES).reverse();

  root.innerHTML = "";

  for (let p = 0; p < TOTAL_PAGES; p++) {
    const page = document.createElement("div");
    page.className = "battlelog-page";

    const start = p * PAGE_SIZE;
    const pageEvents = sliced.slice(start, start + PAGE_SIZE);

    pageEvents.forEach((evt) => {
      const icon = iconFor(evt.type);

      const item = document.createElement("div");
      item.className = "battlelog-item fade-in";

      item.innerHTML = `
        <div class="battlelog-icon ${icon.cls}">
          <span>${icon.sym}</span>
        </div>

        <div class="battlelog-text">
          <div class="battlelog-name">${truncate(safe(evt.display_name), 26)}</div>
          <div class="battlelog-reason">${truncate(safe(evt.reason), 48)}</div>
        </div>
      `;

      page.appendChild(item);
    });

    root.appendChild(page);
  }

  updatePage();
}

// ------------------------------------------------------------
// PAGE SWITCH ANIMATION
// ------------------------------------------------------------
function updatePage() {
  const x = currentPage * -50; // viewport width is 200% for 2 pages
  root.style.transform = `translateX(${x}%)`;
}

// Auto-cycle every 3 seconds
setInterval(() => {
  currentPage = (currentPage + 1) % TOTAL_PAGES;
  updatePage();
}, 3000);

// ------------------------------------------------------------
// STORE SUBSCRIBE
// ------------------------------------------------------------
eventStore.subscribe((state) => {
  render(state.events);
});
