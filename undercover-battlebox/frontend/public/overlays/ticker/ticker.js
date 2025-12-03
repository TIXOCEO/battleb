// ============================================================================
// ticker.js — BattleBox HUD Ticker Renderer (ESPORTS V3)
// ============================================================================

import { initEventRouter } from "/overlays/shared/event-router.js";
import { useTickerStore } from "/overlays/shared/stores.js";

// Enable socket listener only once
initEventRouter();

const inner = document.getElementById("ticker-inner");

// Zustand subscription
useTickerStore.subscribe((state) => {
  inner.textContent = state.text || "";
});
