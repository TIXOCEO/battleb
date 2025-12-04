// ============================================================================
// events.js — BattleBox EVENTS OVERLAY v3.1 (TEXT-ICON VERSION)
// Matches new design: NO AVATAR, ONLY ICONS
// Fully aligned with event-router + fadeOutEvent timing
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { eventStore } from "/overlays/shared/stores.js";

initEventRouter();

const root = document.getElementById("events-list");

const MAX_VISIBLE = 5;
const FADE_DELAY = 5500;   // fade shortly before store removes event
const REMOVE_DELAY = 600;  // match CSS fadeOut duration

// ---------------------------------------------------------
// ICON MAP — Better for OBS (unicode chars)
// ---------------------------------------------------------
function getEventIcon(type) {
  switch (type) {
    case "join":
      return "▶";   // groene pijl naar rechts
    case "leave":
      return "◀";   // rode pijl naar links
    case "promote":
      return "＋";   // groene plus
    case "demote":
      return "－";   // rode min
    default:
      return "▶";   // fallback
  }
}

// ---------------------------------------------------------
// Truncate helper
// ---------------------------------------------------------
function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

// ---------------------------------------------------------
// RENDER FUNCTION
// ---------------------------------------------------------
function render(list) {
  if (!Array.isArray(list)) return;

  const events = list.slice(0, MAX_VISIBLE);

  // Clear old content
  root.innerHTML = "";

  events.forEach((evt) => {
    const name = evt.display_name || "Onbekend";
    const reason = evt.reason || "";
    const type = evt.type || "join";
    const vip = !!evt.is_vip;

    const icon = getEventIcon(type);

    const el = document.createElement("div");
    el.className = "bb-event-item";

    el.innerHTML = `
      <div class="event-icon-wrapper">
        <div class="event-type-icon ${type}">${icon}</div>
      </div>

      <div class="event-text">
        <div class="name">${truncate(name, 22)}</div>
        <div class="reason">${truncate(reason, 28)}</div>
      </div>

      ${vip ? `<div class="event-vip"></div>` : ""}
    `;

    root.appendChild(el);

    // Schedule fade-out animation
    setTimeout(() => {
      el.classList.add("event-fade");
    }, FADE_DELAY);

    // Remove from DOM after fade
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, FADE_DELAY + REMOVE_DELAY);
  });
}

// ---------------------------------------------------------
// SUBSCRIBE — correct store pattern
// ---------------------------------------------------------
eventStore.subscribe((state) => {
  render(state.events);
});
