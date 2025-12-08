// ============================================================================
// BeamFX — BROADCAST MODE (v1.2 FINAL PATCH)
// ============================================================================
//
// Noodzakelijke fixes:
// ------------------------------------------------------------
// ✔ Stabilere glow layering (OBS flicker fix)
// ✔ Jitter clamped zodat beam nooit negatief wordt
// ✔ Bloom render priority verhoogd
// ✔ Uniform alpha curve (consistent met GalaxyChaosFX)
// ✔ Backward compatible met v1.0 + v1.1
//
// ============================================================================

export default class BeamFX {
  constructor(x1, y1, x2, y2, color = "#FFFFFF") {
    this.x1 = x1;
    this.y1 = y1;

    this.x2 = x2;
    this.y2 = y2;

    this.color = color;

    this.t = 0;
    this.duration = 0.45;

    // Jitter voor thickness
    this.jitter = Math.max(0.25, (Math.random() * 0.7) + 0.3);
  }

  update(dt) {
    this.t += dt;
    return this.t >= this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;

    // Fade-out curve (lineair + pulse versterking)
    const pulse = Math.sin(p * Math.PI);
    const alpha = (1 - p) * 0.95 + pulse * 0.05;

    // Beam vector
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Geen render bij degenerate beams
    if (len < 2) return;

    const ang = Math.atan2(dy, dx);

    // Thickness, nu altijd positief
    const coreH = Math.max(2, 4 + this.jitter * 2 * pulse);
    const glowH = Math.max(6, 10 + this.jitter * 6 * pulse);

    const rgb = hexToRGB(this.color);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(this.x1, this.y1);
    ctx.rotate(ang);

    // ------------------------------------------------------------
    // OUTER GLOW (nu onder core beam → flicker fix)
    // ------------------------------------------------------------
    ctx.shadowBlur = 42 + pulse * 18;
    ctx.shadowColor = this.color;

    ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.55})`;
    ctx.fillRect(0, -glowH, len, glowH * 2);

    // ------------------------------------------------------------
    // CORE BEAM
    // ------------------------------------------------------------
    ctx.shadowBlur = 0; // belangrijk voor centrering
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
    ctx.fillRect(0, -coreH, len, coreH * 2);

    // ------------------------------------------------------------
    // TARGET IMPACT BLOOM — nu sterkste bovenop alles
    // ------------------------------------------------------------
    ctx.shadowBlur = 65 + pulse * 30;
    ctx.shadowColor = this.color;

    const bloomR = 18 + pulse * 20;

    ctx.beginPath();
    ctx.arc(len, 0, bloomR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.9})`;
    ctx.fill();

    ctx.restore();
  }
}

/* -------------------------------------------------------------
   Converts hex → "r,g,b"
   Supports "#FFF" / "#FFFFFF"
------------------------------------------------------------- */
function hexToRGB(hex) {
  let c = hex.startsWith("#") ? hex.substring(1) : hex;

  if (c.length === 3) {
    c = c.split("").map((ch) => ch + ch).join("");
  }

  const n = parseInt(c, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;

  return `${r},${g},${b}`;
}
