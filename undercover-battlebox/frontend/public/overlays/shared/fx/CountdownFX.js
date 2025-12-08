// ============================================================================
// CountdownFX — ULTRA MODE
// Smooth pop • neon fade • longer visibility
// ============================================================================

export default class CountdownFX {
  constructor(step = 3) {
    this.step = step;
    this.t = 0;
    this.duration = 1.0;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.t += dt;
    return this.t > this.duration;
  }

  render(ctx) {
    const p = this.t / this.duration;
    const scale = 1 + Math.sin(p * Math.PI) * 0.4;
    const alpha = 1 - p;

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.scale(scale, scale);

    ctx.font = "180px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(255,120,0,${alpha})`;
    ctx.shadowBlur = 40;
    ctx.shadowColor = "rgba(255,120,0,1)";

    ctx.fillText(this.step, 0, 0);

    ctx.restore();
  }
}
