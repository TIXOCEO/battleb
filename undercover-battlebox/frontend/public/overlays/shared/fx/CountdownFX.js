// ============================================================================
// CountdownFX.js — Canvas Number Drop Animation (AOE)
// ============================================================================

export default class CountdownFX {
  constructor(step = 3) {
    this.step = step;
    this.time = 0;
    this.duration = 0.75; // sec voor fade-out
    this.alive = true;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.time += dt;
    if (this.time >= this.duration) return true;
    return false;
  }

  render(ctx) {
    const t = this.time / this.duration;
    const scale = 1 + t * 1.2;
    const alpha = 1 - t;

    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    ctx.fillStyle = "#ff4d00";
    ctx.font = "bold 220px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(this.step), 0, 0);

    ctx.restore();
  }
}
