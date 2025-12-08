// ============================================================================
// BeamFX — ULTRA BROADCAST MODE (v1.1 FINAL)
// ============================================================================
//
// Upgrades in v1.1:
// ------------------------------------------------------------
// ✔ Subtle jitter in beam thickness (energetic look)
// ✔ Pulse intensity synced to lifetime (0 → max → fade)
// ✔ Stronger bloom at target contact
// ✔ Improved RGB converter (supports 3 or 6 hex digits)
// ✔ Fully backward compatible with v1.0 API
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

    // Random jitter seed (beam thickness variation)
    this.jitter = (Math.random() * 0.7) + 0.3;
  }

  update(dt) {
    this.t += dt;
    return this.t >= this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;

    // Fade-out
    const alpha = 1 - p;

    // Energy pulse (strongest halfway)
    const pulse = Math.sin(p * Math.PI);

    // Beam vector
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const len = Math.sqrt(dx * dx + dy * dy);

    // Angle
    const ang = Math.atan2(dy, dx);

    // Thickness jitter + pulse combined
    const coreH = 4 + this.jitter * 2 * pulse;
    const glowH = 10 + this.jitter * 6 * pulse;

    const rgb = hexToRGB(this.color);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(this.x1, this.y1);
    ctx.rotate(ang);

    // ------------------------------------------------------------
    // CORE BEAM
    // ------------------------------------------------------------
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
    ctx.fillRect(0, -coreH, len, coreH * 2);

    // ------------------------------------------------------------
    // OUTER GLOW (stronger than v1.0)
    // ------------------------------------------------------------
    ctx.shadowBlur = 45 + pulse * 20;
    ctx.shadowColor = this.color;

    ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.55})`;
    ctx.fillRect(0, -glowH, len, glowH * 2);

    // ------------------------------------------------------------
    // TARGET IMPACT BLOOM
    // ------------------------------------------------------------
    const bloomR = 16 + pulse * 18;

    ctx.beginPath();
    ctx.arc(len, 0, bloomR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.9})`;
    ctx.fill();

    ctx.restore();
  }
}

/* -------------------------------------------------------------
   Converts hex → "r,g,b"
   Supports:
   - "#FFF"
   - "#ffffff"
------------------------------------------------------------- */
function hexToRGB(hex) {
  let c = hex.startsWith("#") ? hex.substring(1) : hex;

  // Expand 3-digit hex → 6-digit
  if (c.length === 3) {
    c = c.split("").map((ch) => ch + ch).join("");
  }

  const n = parseInt(c, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;

  return `${r},${g},${b}`;
}
