
// ImmuneAuraEffect.js — pulsing turquoise ring

export default class ImmuneAuraEffect {
  constructor() {
    this.duration = 1600;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    const alpha = 0.6 + Math.sin(t * Math.PI * 2) * 0.4;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.strokeStyle = "#00FFAA";
    ctx.lineWidth = 8;
    ctx.shadowColor = "#00FFAA";
    ctx.shadowBlur = 40;

    ctx.beginPath();
    ctx.arc(600, 400, 140, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
