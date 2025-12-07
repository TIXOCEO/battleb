// ============================================================================
// SurvivorShieldFX — blauw beschermschild
// ============================================================================

export default class SurvivorShieldFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 1.2;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const r = 40 + Math.sin(p * Math.PI) * 25;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);

    ctx.strokeStyle = `rgba(80,180,255,${1 - p})`;
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.restore();
  }
}
