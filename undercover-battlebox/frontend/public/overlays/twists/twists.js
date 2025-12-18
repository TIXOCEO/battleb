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
// State
// ---------------------------------------------------------------------------

let deck = [];
let rotationTimer = null;

// ---------------------------------------------------------------------------
// Deck helpers
// ---------------------------------------------------------------------------

function refillDeck(source) {
  deck = shuffle(source);
}

function drawPair(source) {
  if (deck.length < 2) {
    refillDeck(source);
  }

  return [
    deck.shift(),
    deck.shift()
  ];
}

// ---------------------------------------------------------------------------
// Store subscription
// ---------------------------------------------------------------------------

twistStore.subscribe((state) => {
  const incoming = state.visibleTwists || [];
  if (incoming.length < 2) return;

  // First time or twist set changed
  if (!rotationTimer || incoming.length !== deck.length + deck.length % 2) {
    refillDeck(incoming);

    renderTwists(drawPair(incoming));

    clearInterval(rotationTimer);
    rotationTimer = setInterval(() => {
      renderTwists(drawPair(incoming));
    }, 5000);
  }
});
