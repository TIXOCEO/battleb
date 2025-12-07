
// ============================================================================
// GalaxyFX — draaiende sterrennevel
// ============================================================================

export default class GalaxyFX {
  constructor() {
    this.t = 0;
    this.stars = Array.from({ length: 120 }, () => ({
      r: Math.random() * 380 + 20,
      a: Math.random() * Math.PI * 2,
      s: (Math.random() * 0.4) + 0.1,
    }));
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.t += dt;
    return false; // galaxy blijft actief tot twist eindigt
  }

  render(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.5)";

    this.stars.forEach(star => {
      star.a += star.s * 0.02;

      const x = this.cx + Math.cos(star.a) * star.r;
      const y = this.cy + Math.sin(star.a) * star.r;

      ctx.fillRect(x, y, 3, 3);
    });

    ctx.restore();
  }
}
