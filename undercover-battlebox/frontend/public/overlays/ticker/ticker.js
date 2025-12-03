// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer (FIXED)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { tickerStore } from "/overlays/shared/stores.js";

// Init event listener
initEventRouter();

const inner = document.getElementById("ticker-inner");

// Subscribe to store updates
tickerStore.subscribe((state) => {
  inner.textContent = state.text || "";
});
