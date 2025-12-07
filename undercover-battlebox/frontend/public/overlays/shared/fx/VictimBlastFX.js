// ============================================================================
// VictimBlastFX — kleine explosie op elke victim
// ============================================================================

export default class VictimBlastFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 0.5;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const r = p * 60;

    ctx.save();

    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,200,0,${1 - p})`;
    ctx.lineWidth = 6 * (1 - p);
    ctx.stroke();

    ctx.restore();
  }
}
