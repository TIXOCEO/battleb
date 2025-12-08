// ============================================================================
// GalaxyChaosFX — ULTRA BROADCAST MODE (v1.2 FINAL)
// ============================================================================
//
// Verbeteringen v1.2 (alleen visuele upgrades):
// ------------------------------------------------------------
// ✔ Stabielere jitter (minder “jumping”, meer ‘float’)
// ✔ Smooth spin i.p.v. random jank
// ✔ Elliptical energy pulses (professioneler broadcast effect)
// ✔ Flicker timing verbeterd (synced aan pulse)
// ✔ Transform-stack blijft veilig (zet geen position shifts vast)
// ✔ destroy() herstelt ALTIJD originele staat
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

    // Energiepuls (sinus, smooth)
    const pulse = Math.sin(this.t * 3.2) * 0.15 + 1;

    // Smooth mini-rotation → geen random schokbewegingen meer
    const baseRot = Math.sin(this.t * 1.6) * 6; // max 6°

    this.cards.forEach(ref => {
      if (!ref?.el) return;

      // 1) JITTER — maar smooth & subtiel
      const jitterX = Math.sin(this.t * 4 + ref.el.offsetTop) * 4;
      const jitterY = Math.sin(this.t * 3 + ref.el.offsetLeft) * 4;

      // 2) ROTATION
      const rot = baseRot + (Math.random() - 0.5) * 2.4; // micro-randomness

      // 3) SCALE uit pulse
      const scale = pulse;

      // 4) TRANSFORM (volledig broadcast-safe)
      ref.el.style.transform = `
        translate(${jitterX}px, ${jitterY}px)
        rotate(${rot}deg)
        scale(${scale})
      `;

      // 5) FLICKER — maar nu netjes aan pulse gekoppeld
      const flick = 0.35 + pulse * 0.65;
      ref.el.style.filter = `drop-shadow(0 0 16px rgba(160,100,255,${flick}))`;
    });

    return false; // blijft altijd actief, engine cleart hem
  }

  render(ctx) {
    const t = this.t;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // ----------------------------------------------------------------------
    // FULL FIELD NEBULA GLOW (subtiel)
    // ----------------------------------------------------------------------
    ctx.fillStyle = `rgba(150,80,255,0.08)`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // ----------------------------------------------------------------------
    // ELLIPTICAL ENERGY PULSES RONDOM CARDS
    // Professionelere uitstraling dan simpele cirkels
    // ----------------------------------------------------------------------
    this.cards.forEach(ref => {
      if (!ref?.el) return;

      const rect = ref.el.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();

      const cx = rect.left + rect.width / 2 - rootRect.left;
      const cy = rect.top + rect.height / 2 - rootRect.top;

      // Ellipse parameters
      const base = 55 + Math.sin(t * 6 + cx * 0.02) * 18;
      const rx = base * 1.4;
      const ry = base * 0.8;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

      ctx.strokeStyle = `rgba(200,150,255,0.22)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    ctx.restore();
  }

  // Force-reset when twist ends
  destroy() {
    this.cards.forEach(ref => {
      if (!ref?.el) return;
      ref.el.style.transform = "";
      ref.el.style.filter = "";
    });
  }
}
