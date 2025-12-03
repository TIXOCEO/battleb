// ============================================================================
// twists.js — Renders 3 rotating twist-cards
// ============================================================================

import { initEventRouter } from "overlays/shared/event-router.js";
import { useTwistStore } from "overlays/shared/stores.js";

// Start the event router (sets up twist rotation automatically)
initEventRouter();

const stack = document.getElementById("twist-stack");

// Subscribe to twist changes
useTwistStore.subscribe((state) => {
  const twists = state.visibleTwists || [];

  // Fade existing cards out
  Array.from(stack.children).forEach((child) => {
    child.classList.add("twist-fade");
  });

  // Clear after fade animation
  setTimeout(() => {
    stack.innerHTML = "";

    twists.forEach((tw) => {
      const el = document.createElement("div");
      el.className = "bb-twist-card";

      el.innerHTML = `
        <div class="twist-icon"></div>

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

      stack.appendChild(el);
    });
  }, 300); // sync with twist-fade keyframe duration
});
