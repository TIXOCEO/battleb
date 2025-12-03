// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { tickerStore } from "/overlays/shared/stores.js";

// Enable socket listener
initEventRouter();

const inner = document.getElementById("ticker-inner");

// Subscribe to store updates
tickerStore.subscribe((text) => {
  inner.textContent = text || "";
});
