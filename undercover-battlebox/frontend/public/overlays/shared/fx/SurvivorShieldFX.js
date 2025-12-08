// ============================================================================
// SurvivorShieldFX — ULTRA MODE
// protective bubble • ripple shield • pulse glow
// ============================================================================

export default class SurvivorShieldFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 1.8;
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

    // Main bubble
    const r = 60 + Math.sin(p * Math.PI) * 35;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,190,${alpha})`;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Inner neon pulse
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.65, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,255,${alpha * 0.6})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Radiant glow
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(120,255,255,${alpha * 0.25})`;
    ctx.lineWidth = 22 * (1 - p);
    ctx.stroke();

    ctx.restore();
  }
}
