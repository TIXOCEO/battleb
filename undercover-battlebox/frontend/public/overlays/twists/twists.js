// ============================================================================
// twists.js — RANDOM 2 OF ALL TWISTS, AUTO ROTATE (DROP-IN FINAL)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { twistStore } from "/overlays/shared/stores.js";

initEventRouter();

const stack = document.getElementById("twist-stack");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allTwists = [];
let rotationTimer = null;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderTwists(twists) {
  // Fade out existing
  Array.from(stack.children).forEach((child) => {
    child.classList.add("twist-fade");
  });

  setTimeout(() => {
    stack.innerHTML = "";

    twists.forEach((tw) => {
      const card = document.createElement("div");
      card.className = "bb-twist-card";

      const iconUrl = tw.icon || "/overlays/shared/default-icon.png";

      const aliasBadges = (tw.aliases || [])
        .map(a => `<span class="alias-badge">!use ${a} @target</span>`)
        .join("");

      card.innerHTML = `
        <div class="twist-info">

          <!-- 1. TWISTNAAM -->
          <div class="twist-name">${tw.twistName}</div>

          <!-- 2. GIFTNAAM -->
          <div class="twist-gift">${tw.giftName}</div>

          <!-- 3. ICON -->
          <div class="twist-icon" style="background-image:url('${iconUrl}')"></div>

          <!-- 4. DESCRIPTION -->
          <div class="twist-desc">${tw.description}</div>

          <!-- 5. BADGE LIST -->
          <div class="twist-commands">
            ${aliasBadges}
          </div>

        </div>
      `;

      stack.appendChild(card);
    });
  }, 260);
}

// ---------------------------------------------------------------------------
// Store subscription
// ---------------------------------------------------------------------------

twistStore.subscribe((state) => {
  const incoming = state.visibleTwists || [];
  if (!incoming.length) return;

  allTwists = incoming;

  // Start rotation once
  if (rotationTimer) return;

  // Initial render
  renderTwists(shuffle(allTwists).slice(0, 2));

  rotationTimer = setInterval(() => {
    if (!allTwists.length) return;
    renderTwists(shuffle(allTwists).slice(0, 2));
  }, 5000); // 🔁 wissel elke 5 seconden
});
