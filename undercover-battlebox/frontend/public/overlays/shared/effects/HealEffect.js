// HealEffect.js — pulsating neon-green cross

export default class HealEffect {
  constructor() {
    this.duration = 1200;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    const alpha = 1 - t;
    const scale = 0.7 + t * 0.4;

    ctx.save();
    ctx.translate(600, 400);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#00FF55";
    ctx.shadowColor = "#00FF55";
    ctx.shadowBlur = 40;

    // Vertical bar
    ctx.fillRect(-20 * scale, -80 * scale, 40 * scale, 160 * scale);

    // Horizontal bar
    ctx.fillRect(-80 * scale, -20 * scale, 160 * scale, 40 * scale);

    ctx.restore();
  }
}
