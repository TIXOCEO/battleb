// ============================================================================
// CountdownFX — floating 3 → 2 → 1 numbers
// ============================================================================

export default class CountdownFX {
  constructor(step = 3) {
    this.step = step;
    this.time = 0;
    this.duration = 0.7;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.time += dt;
    return this.time > this.duration;
  }

  render(ctx) {
    ctx.save();
    ctx.font = "120px Rajdhani";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const alpha = 1 - (this.time / this.duration);
    ctx.globalAlpha = alpha;

    ctx.fillText(this.step, this.cx, this.cy);
    ctx.restore();
  }
}
