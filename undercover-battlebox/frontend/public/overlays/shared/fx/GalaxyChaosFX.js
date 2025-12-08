// ============================================================================
// GalaxyChaosFX — ULTRA BROADCAST MODE (v1.3 FINAL)
// ============================================================================
//
// Nodige fixes t.o.v. v1.2:
// ------------------------------------------------------------
// ✔ Normalized jitter (geen spikes meer door offsetTop/Left)
// ✔ Zero-drift transforms (rotation/scale nooit accumulerend)
// ✔ OBS-safe filter (geen ghost shadows)
// ✔ Elliptical pulses automatisch geclamped aan viewport
// ✔ destroy() reset ALTIJD alle styles zonder edge-cases
// ✔ Compat-layer: enableGalaxyChaos() + disableGalaxyChaos()
//      → noodzakelijk voor arena.js v9.x
//
// ============================================================================

export default class GalaxyChaosFX {
  constructor(cardRefs, root) {
    this.cards = cardRefs;
    this.root = root;

    this.t = 0;
    this.duration = 9999; // actief tot twist:clear
  }

  update(dt) {
    this.t += dt;

    const pulse = Math.sin(this.t * 3.2) * 0.15 + 1;
    const baseRot = Math.sin(this.t * 1.8) * 5.5;

    this.cards.forEach(ref => {
      if (!ref?.el) return;
      const el = ref.el;

      const jitterX = Math.sin(this.t * 4 + el.dataset.seedX) * 3.8;
      const jitterY = Math.sin(this.t * 3 + el.dataset.seedY) * 3.8;

      const rot = baseRot + Math.sin(this.t * 2.1 + el.dataset.seedR) * 2.2;
      const scale = pulse;

      el.style.transform = `
        translate(${jitterX}px, ${jitterY}px)
        rotate(${rot}deg)
        scale(${scale})
      `;

      const flick = 0.35 + pulse * 0.55;
      el.style.filter = `drop-shadow(0 0 16px rgba(160,100,255,${flick}))`;
    });

    return false;
  }

  render(ctx) {
    const t = this.t;
    const canvas = ctx.canvas;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.fillStyle = `rgba(150,80,255,0.08)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maxR = Math.min(canvas.width, canvas.height) * 0.22;

    this.cards.forEach(ref => {
      if (!ref?.el) return;

      const rect = ref.el.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();

      const cx = rect.left + rect.width / 2 - rootRect.left;
      const cy = rect.top + rect.height / 2 - rootRect.top;

      const base = 55 + Math.sin(t * 6 + cx * 0.03) * 18;
      const r = Math.min(base, maxR);

      const rx = r * 1.35;
      const ry = r * 0.82;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,150,255,0.22)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }

  destroy() {
    this.cards.forEach(ref => {
      if (!ref?.el) return;
      ref.el.style.transform = "";
      ref.el.style.filter = "";
    });
  }
}

// ============================================================================
// COMPAT LAYER — noodzakelijk voor arena.js v9.x
// ----------------------------------------------------------------------------
// arena.js verwacht:
//
// import { enableGalaxyChaos, disableGalaxyChaos } from "./GalaxyChaosFX.js"
//
// Deze helpers moeten bestaan, anders breekt de overlay.
// ============================================================================

let chaosInstance = null;

/**
 * Start GalaxyChaosFX
 */
export function enableGalaxyChaos(cardRefs, root = document.body) {
  // Unieke seeds genereren voor smooth jitter
  cardRefs.forEach(ref => {
    if (!ref?.el) return;
    ref.el.dataset.seedX = Math.random();
    ref.el.dataset.seedY = Math.random();
    ref.el.dataset.seedR = Math.random();
  });

  chaosInstance = new GalaxyChaosFX(cardRefs, root);
  return chaosInstance;
}

/**
 * Stop GalaxyChaosFX en reset transforms
 */
export function disableGalaxyChaos(cardRefs) {
  if (chaosInstance) {
    chaosInstance.destroy();
    chaosInstance = null;
  }

  // Hard reset fallback
  cardRefs.forEach(ref => {
    if (!ref?.el) return;
    ref.el.style.transform = "";
    ref.el.style.filter = "";
  });
}
