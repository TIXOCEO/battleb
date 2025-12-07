// BreakerEffect.js — purple crack-burst (immune breaker)

export default class BreakerEffect {
  constructor() {
    this.duration = 850;
    this.start = performance.now();
    this.active = true;

    this.lines = [...Array(14)].map(() => ({
      ang: Math.random() * Math.PI * 2,
      len: 40 + Math.random() * 50
    }));
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    const alpha = 1 - t;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#AA33FF";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#AA33FF";
    ctx.shadowBlur = 25;

    for (const l of this.lines) {
      ctx.beginPath();
      ctx.moveTo(600, 400);
      ctx.lineTo(
        600 + Math.cos(l.ang) * l.len * (1 + t * 3),
        400 + Math.sin(l.ang) * l.len * (1 + t * 3)
      );
      ctx.stroke();
    }

    ctx.restore();
  }
}
