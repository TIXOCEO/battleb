// TargetEffect.js — pulsing orange marker + name tag

export default class TargetEffect {
  constructor(name = "") {
    this.name = name;
    this.duration = 900;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;
    const alpha = 1 - t;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#F14A04";
    ctx.lineWidth = 6 + t * 4;
    ctx.shadowColor = "#F14A04";
    ctx.shadowBlur = 35;

    ctx.beginPath();
    ctx.arc(600, 400, 160 + t * 50, 0, Math.PI * 2);
    ctx.stroke();

    // Title
    ctx.font = "48px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#F14A04";
    ctx.shadowBlur = 30;
    ctx.fillText(this.name, 600, 400);

    ctx.restore();
  }
}
