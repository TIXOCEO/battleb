// ============================================================================
// TargetPulseFX — pulserende cirkel op target speler
// ============================================================================

export default class TargetPulseFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.t = 0;
    this.duration = 0.7;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const radius = 20 + p * 80;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);

    ctx.strokeStyle = `rgba(255,80,80,${1 - p})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }
}
