// ============================================================================
// TargetPulseFX.js — Single Player Focus Pulse
// ============================================================================

export default class TargetPulseFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.time = 0;
    this.duration = 0.5;
  }

  setup() {}

  update(dt) {
    this.time += dt;
    return this.time >= this.duration;
  }

  render(ctx) {
    const t = this.time / this.duration;
    const radius = 40 + t * 90;
    const alpha = 1 - t;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,80,0,${alpha})`;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
  }
}
