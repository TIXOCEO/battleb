// ============================================================================
// battlelog.js — BattleBox BattleLog v1.0
// Shows last 3 events, newest on top, animated slide + fade
// ============================================================================

import { eventStore } from "/overlays/shared/stores.js";
import { initEventRouter } from "/overlays/shared/event-router.js";

initEventRouter();

const root = document.getElementById("battlelog-list");
const MAX = 3;

function iconFor(type) {
  if (!type) return "▶";

  if (type.startsWith("twist:")) return "★";

  switch (type) {
    case "join": return "➤";
    case "leave": return "←";
    case "promote": return "↑";
    case "demote": return "↓";
    case "arenaJoin": return "⯈";
    case "arenaLeave": return "⯇";
    case "eliminated": return "✖";
    default: return "•";
  }
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

let lastCount = 0;

function render(events) {
  const list = events.slice(0, MAX);

  root.innerHTML = "";

  list.forEach((evt, index) => {
    const el = document.createElement("div");
    el.className = "battlelog-item";

    // Animate shift for old items
    if (events.length > lastCount && index > 0) {
      el.classList.add("battlelog-shift");
    }

    const icon = iconFor(evt.type);

    el.innerHTML = `
      <div class="battlelog-icon">${icon}</div>

      <div class="battlelog-text">
        <div class="name">${truncate(evt.display_name, 28)}</div>
        <div class="reason">${truncate(evt.reason, 80)}</div>
      </div>

      ${evt.is_vip ? `<div class="battlelog-vip"></div>` : ""}
    `;

    root.appendChild(el);
  });

  lastCount = events.length;
}

eventStore.subscribe((state) => {
  render(state.events);
});
