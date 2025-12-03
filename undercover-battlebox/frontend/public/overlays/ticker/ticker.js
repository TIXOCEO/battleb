// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer
// ============================================================================

import { initEventRouter } from "overlays/shared/event-router.js";
import { useTickerStore } from "overlays/shared/stores.js";

// Start event router (enables hudTickerUpdate)
initEventRouter();

const inner = document.getElementById("ticker-inner");

// Subscribe to ticker store updates
useTickerStore.subscribe((state) => {
  const text = state.text || "";
  inner.textContent = text;
});
