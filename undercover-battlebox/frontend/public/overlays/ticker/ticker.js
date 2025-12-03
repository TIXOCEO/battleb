// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer (SNAPSHOT EDITION)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { tickerStore } from "/overlays/shared/stores.js";

// Enable router + snapshot
initEventRouter();

const inner = document.getElementById("ticker-inner");

// Subscribe to store updates
tickerStore.subscribe((state) => {
  inner.textContent = state.text || "";
});
