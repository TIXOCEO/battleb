// ============================================================================
// BombFX — ULTRA MODE
// Double shockwave • fireball bloom • vapor ring • smoke
// ============================================================================

export default class BombFX {
  constructor() {
    this.t = 0;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.t += dt;
    return this.t > 2.2; // longer animation
  }

  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const t = this.t;

    // FIREBALL BLOOM
    if (t < 0.45) {
      const p = t / 0.45;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 20 + p * 160, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,50,0,${1 - p})`;
      ctx.fill();
    }

    // INNER SHOCKWAVE
    if (t < 1.0) {
      const p = t / 1.0;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 40 + p * 260, 0, Math.PI * 2);
      ctx.lineWidth = 18 * (1 - p);
      ctx.strokeStyle = `rgba(255,120,0,${1 - p})`;
      ctx.stroke();
    }

    // OUTER SHOCKWAVE
    if (t > 0.3 && t < 1.6) {
      const p = (t - 0.3) / 1.3;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 120 + p * 420, 0, Math.PI * 2);
      ctx.lineWidth = 10 * (1 - p);
      ctx.strokeStyle = `rgba(255,200,120,${1 - p})`;
      ctx.stroke();
    }

    // SMOKE
    if (t > 0.4) {
      const p = (t - 0.4) / 1.8;
      ctx.fillStyle = `rgba(120,120,120,${0.5 * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, 180 + p * 200, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
