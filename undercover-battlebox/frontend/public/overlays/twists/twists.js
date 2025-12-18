// ============================================================================
// twists.js — FAIR 2-OF-N ROTATION (NO REPEAT, DROP-IN FINAL)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { twistStore } from "/overlays/shared/stores.js";

initEventRouter();

const stack = document.getElementById("twist-stack");

// ---------------------------------------------------------------------------
// Fisher–Yates shuffle (UNBIASED)
// ---------------------------------------------------------------------------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let queue = [];
let index = 0;
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

          <div class="twist-name">${tw.twistName}</div>
          <div class="twist-gift">${tw.giftName}</div>

          <div class="twist-icon"
               style="background-image:url('${iconUrl}')"></div>

          <div class="twist-desc">${tw.description}</div>

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
// Rotation logic
// ---------------------------------------------------------------------------

function nextPair() {
  if (queue.length < 2) return [];

  // If near end → reshuffle cleanly
  if (index + 1 >= queue.length) {
    queue = shuffle(queue);
    index = 0;
  }

  const pair = [
    queue[index],
    queue[index + 1]
  ];

  index += 2;
  return pair;
}

// ---------------------------------------------------------------------------
// Store subscription
// ---------------------------------------------------------------------------

twistStore.subscribe((state) => {
  const incoming = state.visibleTwists || [];
  if (incoming.length < 2) return;

  // Init once or if twist set changed
  if (!rotationTimer || incoming.length !== queue.length) {
    queue = shuffle(incoming);
    index = 0;

    renderTwists(nextPair());

    clearInterval(rotationTimer);
    rotationTimer = setInterval(() => {
      renderTwists(nextPair());
    }, 5000); // 🔁 elke 5s
  }
});
