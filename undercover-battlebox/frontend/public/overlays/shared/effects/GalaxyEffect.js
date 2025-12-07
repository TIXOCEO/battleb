// GalaxyEffect.js — swirling neon vortex

export default class GalaxyEffect {
  constructor(reverse = false) {
    this.reverse = reverse;
    this.duration = 2000;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx, now) {
    const t = (now - this.start) / this.duration;

    ctx.save();
    ctx.globalAlpha = 0.9 - t * 0.6;

    const rot = (t * 4 * Math.PI) * (this.reverse ? -1 : 1);

    ctx.translate(600, 400);
    ctx.rotate(rot);

    // Outer ring
    ctx.strokeStyle = "#0FFFD7";
    ctx.lineWidth = 8;
    ctx.shadowColor = "#0FFFD7";
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(0, 0, 260, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring
    ctx.strokeStyle = "#8B5CF6";
    ctx.lineWidth = 6;
    ctx.shadowColor = "#8B5CF6";
    ctx.shadowBlur = 35;
    ctx.beginPath();
    ctx.arc(0, 0, 160, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
