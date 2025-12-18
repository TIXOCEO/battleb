// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer (SMART MARQUEE)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { tickerStore } from "/overlays/shared/stores.js";

initEventRouter();

const inner = document.getElementById("ticker-inner");
const container = inner.parentElement;

let currentText = "";

function startMarquee(text) {
  if (!text) return;

  // Reset animation
  inner.style.animation = "none";
  inner.offsetHeight; // force reflow

  inner.textContent = text;

  // Measure widths
  const containerWidth = container.offsetWidth;
  const textWidth = inner.scrollWidth;

  // Start off-screen right → fully off-screen left
  const from = containerWidth;
  const to = -textWidth;

  // Speed: px per second (tweakable)
  const SPEED = 90; // lager = trager, hoger = sneller
  const distance = containerWidth + textWidth;
  const duration = distance / SPEED;

  // Inject CSS variables
  inner.style.setProperty("--from", `${from}px`);
  inner.style.setProperty("--to", `${to}px`);

  // Apply animation
  inner.style.animation = `
    tickerScroll ${duration}s linear infinite,
    tickerGlow 3.6s ease-in-out infinite
  `;
}

// Subscribe to store updates
tickerStore.subscribe((state) => {
  const next = state.text || "";
  if (next === currentText) return;

  currentText = next;
  startMarquee(next);
});
