// ============================================================================
// BeamFX — ULTRA BROADCAST MODE (v1.0 FINAL)
// ============================================================================
//
// ✔ Neon beam tussen twee punten (origin → target)
// ✔ Additive glow, motion-blur style
// ✔ Automatisch fade-out over 0.45 sec
// ✔ Perfect voor moneygun / diamond / immune / heal
// ✔ 100% OBS friendly (geen CSS nodig)
//
// ============================================================================

export default class BeamFX {
  constructor(x1, y1, x2, y2, color = "#FFFFFF") {
    // Startpunt (bijv. center HUD)
    this.x1 = x1;
    this.y1 = y1;

    // Eindpunt (bijv. target card center)
    this.x2 = x2;
    this.y2 = y2;

    this.color = color;

    this.t = 0;
    this.duration = 0.45; // ultra snappy beam
  }

  update(dt) {
    this.t += dt;
    return this.t >= this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const alpha = 1 - p; // fade-out effect

    // Beam vector
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Beam angle
    const ang = Math.atan2(dy, dx);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(this.x1, this.y1);
    ctx.rotate(ang);

    // CORE BEAM
    ctx.fillStyle = `rgba(${hexToRGB(this.color)}, ${alpha})`;
    ctx.fillRect(0, -4, len, 8);

    // OUTER GLOW
    ctx.shadowBlur = 35;
    ctx.shadowColor = this.color;

    ctx.fillStyle = `rgba(${hexToRGB(this.color)}, ${alpha * 0.65})`;
    ctx.fillRect(0, -8, len, 16);

    // SOFT BLAST AT TARGET
    ctx.beginPath();
    ctx.arc(len, 0, 18, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${hexToRGB(this.color)}, ${alpha})`;
    ctx.fill();

    ctx.restore();
  }
}

// Converts "#RRGGBB" → "R,G,B"
function hexToRGB(hex) {
  const c = hex.startsWith("#") ? hex.substring(1) : hex;
  const n = parseInt(c, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r},${g},${b}`;
}
