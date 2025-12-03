// ============================================================================
// utils.js — BattleBox Overlay DOM Utilities v1.0 (Pure JS)
// Lightweight DOM helpers used across overlays
// Works in OBS BrowserSource / static HTML
// ============================================================================

/**
 * Create a DOM element with an optional class
 * @param {string} tag
 * @param {string} [cls]
 * @returns {HTMLElement}
 */
export function createDom(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

/**
 * Shortcut for <div>
 * @param {string} [cls]
 * @returns {HTMLDivElement}
 */
export function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

/**
 * Create a text node
 * @param {string} str
 * @returns {Text}
 */
export function text(str) {
  return document.createTextNode(str);
}
