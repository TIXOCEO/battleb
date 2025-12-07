// CountdownEffect.js — counts 3 → 2 → 1 with radial pulse

export default class CountdownEffect {
  constructor(step = 3) {
    this.step = step;
    this.duration = 900;            // ms
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    if (t >= 1) return;

    const alpha = 1 - t;
    const scale = 0.5 + t * 0.7;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#F14A04";
    ctx.shadowColor = "#F14A04";
    ctx.shadowBlur = 50;

    ctx.font = `${220 * scale}px Rajdhani`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(this.step), 600, 400);

    ctx.restore();
  }
}
