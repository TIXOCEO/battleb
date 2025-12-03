// ============================================================================
// twists.js — Rotating twist cards (SNAPSHOT EDITION)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { twistStore } from "/overlays/shared/stores.js";

// Start router (once)
initEventRouter();

const stack = document.getElementById("twist-stack");

// Subscribe to twist rotation store
twistStore.subscribe((state) => {
  const visibleTwists = state.visibleTwists || [];

  // Fade out existing cards
  Array.from(stack.children).forEach((child) => {
    child.classList.add("twist-fade");
  });

  // Re-render after fade
  setTimeout(() => {
    stack.innerHTML = "";

    visibleTwists.forEach((tw) => {
      const card = document.createElement("div");
      card.className = "bb-twist-card";

      const iconUrl =
        tw.icon ||
        "/overlays/shared/default-icon.png";

      card.innerHTML = `
        <div class="twist-icon" style="background-image:url('${iconUrl}')"></div>

        <div class="twist-info">
          <div class="twist-name">${tw.name}</div>
          <div class="twist-gift">${tw.gift}</div>
          <div class="twist-cost">${tw.diamonds} 💎</div>
          <div class="twist-desc">${tw.description}</div>

          <div class="twist-commands">
            <span>!buy ${tw.aliases[0]}</span>
            ${
              tw.aliases[1]
                ? `<span>!use ${tw.aliases[1]} @target</span>`
                : `<span>!use ${tw.aliases[0]} @target</span>`
            }
          </div>
        </div>
      `;

      stack.appendChild(card);
    });
  }, 300);
});
