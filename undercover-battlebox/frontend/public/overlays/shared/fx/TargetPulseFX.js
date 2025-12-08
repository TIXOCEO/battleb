// ============================================================================
// TargetPulseFX — ULTRA MODE
// triple rings • neon ripple • smoother fade-out
// ============================================================================

export default class TargetPulseFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 1.1;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const alpha = 1 - p;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // 3 rings expanding
    for (let i = 0; i < 3; i++) {
      const offset = i * 0.12;
      if (p < offset) continue;

      const progress = (p - offset) / (1 - offset);
      const radius = 20 + progress * 140;

      ctx.beginPath();
      ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,90,60,${alpha * (1.2 - i * 0.35)})`;
      ctx.lineWidth = 5 - i;
      ctx.stroke();
    }

    // glow point
    ctx.beginPath();
    ctx.arc(this.x, this.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,120,80,${alpha})`;
    ctx.fill();

    ctx.restore();
  }
}
