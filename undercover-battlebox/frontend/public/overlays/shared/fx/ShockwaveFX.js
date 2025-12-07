// ============================================================================
// ShockwaveFX.js — Expanding Neon Shock Ring
// ============================================================================

export default class ShockwaveFX {
  constructor(x, y, color = "rgba(255,80,0,1)") {
    this.x = x;
    this.y = y;
    this.color = color;
    this.time = 0;
    this.duration = 0.8;
  }

  setup() {}

  update(dt) {
    this.time += dt;
    return this.time >= this.duration;
  }

  render(ctx) {
    const t = this.time / this.duration;
    const radius = 20 + t * 240;
    const alpha = 1 - t;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = this.color.replace(",1)", `,${alpha})`);
    ctx.lineWidth = 6 - t * 5;
    ctx.stroke();
    ctx.restore();
  }
}
