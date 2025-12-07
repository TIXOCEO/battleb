// BombEffect.js — expanding shockwave + explosive core

export default class BombEffect {
  constructor() {
    this.duration = 900;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    if (t >= 1) return;

    const coreScale = 1 + t * 1.6;
    const waveScale = 1 + t * 14;

    // Core
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = "#FF0033";
    ctx.shadowColor = "#FF0033";
    ctx.shadowBlur = 40;

    ctx.beginPath();
    ctx.arc(600, 400, coreScale * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Shockwave
    ctx.save();
    ctx.globalAlpha = 0.7 * (1 - t);
    ctx.strokeStyle = "rgba(255,0,60,0.6)";
    ctx.lineWidth = 6 + t * 1;

    ctx.beginPath();
    ctx.arc(600, 400, waveScale * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
