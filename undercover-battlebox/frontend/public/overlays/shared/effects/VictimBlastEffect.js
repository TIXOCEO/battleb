// VictimBlastEffect.js — multiple red bursts for multiple victims

export default class VictimBlastEffect {
  constructor(names = []) {
    this.bursts = [];

    for (const n of names) {
      this.bursts.push({
        name: n,
        start: performance.now(),
        duration: 900,
        particles: [...Array(18)].map(() => ({
          x: 600,
          y: 400,
          vx: (Math.random() - 0.5) * 16,
          vy: (Math.random() - 0.5) * 16,
        })),
      });
    }

    this.active = true;
  }

  isDone(now) {
    return this.bursts.every(b => now - b.start > b.duration);
  }

  draw(ctx, now) {
    for (const b of this.bursts) {
      const t = (now - b.start) / b.duration;
      if (t >= 1) continue;

      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#FF0033";
      ctx.shadowColor = "#FF0033";
      ctx.shadowBlur = 30;

      // Particles
      for (let p of b.particles) {
        ctx.fillRect(p.x, p.y, 8, 8);
        p.x += p.vx;
        p.y += p.vy;
      }

      // Name
      ctx.font = "34px Rajdhani";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(b.name, 600, 400);

      ctx.restore();
    }
  }
}
