// ============================================================================
// GalaxyFX.js — Rotating Nebula + Starfield Swirl
// ============================================================================

export default class GalaxyFX {
  constructor() {
    this.time = 0;
    this.duration = 3.5;

    this.stars = [];
    for (let i = 0; i < 180; i++) {
      this.stars.push({
        angle: Math.random() * Math.PI * 2,
        dist: 60 + Math.random() * 380,
        size: 1 + Math.random() * 2,
      });
    }
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.time += dt;
    return this.time >= this.duration;
  }

  render(ctx) {
    const rot = this.time * 0.6;

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rot);

    this.stars.forEach((s) => {
      const x = Math.cos(s.angle) * s.dist;
      const y = Math.sin(s.angle) * s.dist;

      ctx.fillStyle = "rgba(0,255,255,0.7)";
      ctx.fillRect(x, y, s.size, s.size);
    });

    ctx.restore();
  }
}
