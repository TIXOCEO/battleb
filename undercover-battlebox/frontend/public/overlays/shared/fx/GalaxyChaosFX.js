// ============================================================================
// GalaxyChaosFX — ULTRA BROADCAST MODE (v1.0 FINAL)
// ============================================================================
//
// Doel:
// Tijdens GALAXY twist → alle player cards gaan:
//  ✔ zacht spinnen
//  ✔ chaotisch trillen
//  ✔ neon-flicker highlight
//  ✔ canvas energy pulses rond elke card
//
// Let op:
//  - Deze FX module verandert ALLEEN visual movement (geen posities permanent)
//  - Zodra twist eindigt verdwijnt effect automatisch
//
// ============================================================================

export default class GalaxyChaosFX {
  constructor(cardRefs, root) {
    this.cards = cardRefs;
    this.root = root;

    this.t = 0;
    this.duration = 9999; // blijft actief totdat twist:clear gebeurt
  }

  update(dt) {
    this.t += dt;

    const pulse = Math.sin(this.t * 4) * 0.4 + 1;

    // Apply chaotic transforms to DOM cards
    this.cards.forEach(ref => {
      if (!ref?.el) return;

      const jitterX = (Math.random() - 0.5) * 8;
      const jitterY = (Math.random() - 0.5) * 8;
      const rot = (Math.sin(this.t * 3 + Math.random()) * 5);

      ref.el.style.transform = `
        translate(${jitterX}px, ${jitterY}px)
        rotate(${rot}deg)
        scale(${pulse})
      `;

      const flick = Math.random() < 0.08 ? 1 : 0.4;
      ref.el.style.filter = `drop-shadow(0 0 12px rgba(120,80,255,${flick}))`;
    });

    return false; // blijft actief tot clear()
  }

  render(ctx) {
    const t = this.t;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Purple pulsating field
    ctx.fillStyle = `rgba(150,80,255,0.10)`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Around-card pulses
    this.cards.forEach(ref => {
      if (!ref?.el) return;

      const rect = ref.el.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();

      const cx = rect.left + rect.width / 2 - rootRect.left;
      const cy = rect.top + rect.height / 2 - rootRect.top;

      const r = 50 + Math.sin(t * 6 + cx * 0.1) * 20;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,120,255,0.25)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }

  // Force-reset on clear
  destroy() {
    this.cards.forEach(ref => {
      if (!ref?.el) return;
      ref.el.style.transform = "";
      ref.el.style.filter = "";
    });
  }
}
