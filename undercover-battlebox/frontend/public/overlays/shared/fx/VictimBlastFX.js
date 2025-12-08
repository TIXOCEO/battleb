// ============================================================================
// VictimBlastFX — ULTRA MODE
// expanding fire ring • core flash • scorch pulse
// ============================================================================

export default class VictimBlastFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 0.9;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Core flash
    if (p < 0.25) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, 40 - p * 20, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,160,60,${1 - p * 4})`;
      ctx.fill();
    }

    // Fire ring
    const radius = 40 + p * 180;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 14 * (1 - p);
    ctx.strokeStyle = `rgba(255,120,0,${1 - p})`;
    ctx.stroke();

    // Scorch field
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,80,0,${0.4 * (1 - p)})`;
    ctx.fill();

    ctx.restore();
  }
}
