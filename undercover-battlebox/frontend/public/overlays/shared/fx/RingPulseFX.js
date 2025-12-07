// ============================================================================
// RingPulseFX.js — Expanding Soft Energy Ring
// ============================================================================

export default class RingPulseFX {
  constructor(x, y, color = "rgba(0,255,120,1)") {
    this.x = x;
    this.y = y;
    this.color = color;
    this.time = 0;
    this.duration = 0.9;
  }

  setup() {}

  update(dt) {
    this.time += dt;
    return this.time >= this.duration;
  }

  render(ctx) {
    const t = this.time / this.duration;
    const radius = 25 + t * 180;
    const alpha = 0.8 - t * 0.8;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = this.color.replace(",1)", `,${alpha})`);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }
}
