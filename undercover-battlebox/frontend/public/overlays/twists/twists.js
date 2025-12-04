// ============================================================================
// twists.js — 2 FULL-HEIGHT CARDS, CENTERED
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { twistStore } from "/overlays/shared/stores.js";

initEventRouter();

const stack = document.getElementById("twist-stack");

twistStore.subscribe((state) => {
  const all = state.visibleTwists || [];
  const visibleTwists = all.slice(0, 2); // EXACT 2 CARDS

  // Fade old cards
  Array.from(stack.children).forEach((child) => {
    child.classList.add("twist-fade");
  });

  setTimeout(() => {
    stack.innerHTML = "";

    visibleTwists.forEach((tw) => {
      const card = document.createElement("div");
      card.className = "bb-twist-card";

      const iconUrl = tw.icon || "/overlays/shared/default-icon.png";

      card.innerHTML = `
        <div class="twist-icon" style="background-image:url('${iconUrl}')"></div>

        <div class="twist-info">
          <div class="twist-name">${tw.name}</div>
          <div class="twist-gift">${tw.gift}</div>
          <div class="twist-desc">${tw.description}</div>

          <div class="twist-commands">
            <span>!use ${tw.aliases[0]} @target</span>
          </div>
        </div>
      `;

      stack.appendChild(card);
    });
  }, 260);
});
