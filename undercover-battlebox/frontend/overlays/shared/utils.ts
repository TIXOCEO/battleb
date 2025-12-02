export function createDom(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}
