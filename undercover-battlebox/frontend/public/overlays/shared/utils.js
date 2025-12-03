// ============================================================================
// utils.ts — Shared DOM Helpers (Strict Mode Safe)
// ============================================================================

/**
 * Create a DOM element with an optional class
 */
export function createDom<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (cls) {
    (el as HTMLElement).className = cls;
  }

  return el;
}

/**
 * Create a div with classes
 */
export function div(cls?: string): HTMLDivElement {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

/**
 * Create text node
 */
export function text(str: string): Text {
  return document.createTextNode(str);
}
