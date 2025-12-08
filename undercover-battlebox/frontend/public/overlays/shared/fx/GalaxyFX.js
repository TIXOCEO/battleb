// ============================================================================
// GalaxyFX — ULTRA MODE
// nebula clouds • parallax stars • central pulse
// ============================================================================

export default class GalaxyFX {
  constructor() {
    this.t = 0;

    this.stars = Array.from({ length: 280 }, () => ({
      r: Math.random() * 500 + 50,
      a: Math.random() * Math.PI * 2,
      s: (Math.random() * 0.6) + 0.2,
      size: Math.random() * 2.2 + 0.6,
    }));
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.t += dt;
    return false; // stays active until twist clears
  }

  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Cosmic mist overlay
    ctx.fillStyle = "rgba(80,10,120,0.25)";
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 500, 0, Math.PI * 2);
    ctx.fill();

    // Stars
    this.stars.forEach(s => {
      s.a += s.s * 0.015;
      const x = this.cx + Math.cos(s.a) * s.r;
      const y = this.cy + Math.sin(s.a) * s.r;

      ctx.fillStyle = `rgba(180,180,255,0.8)`;
      ctx.fillRect(x, y, s.size, s.size);
    });

    // Pulsing nebula core
    const pulse = Math.sin(this.t * 2) * 0.3 + 1.2;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 120 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(150,80,255,0.55)";
    ctx.fill();

    ctx.restore();
  }
}
