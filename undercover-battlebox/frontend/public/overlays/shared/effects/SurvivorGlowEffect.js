// SurvivorGlowEffect.js — blue glow + swirl

export default class SurvivorGlowEffect {
  constructor(name = "") {
    this.name = name;
    this.duration = 1400;
    this.start = performance.now();

    this.particles = [...Array(32)].map((_, i) => ({
      angle: (i / 32) * Math.PI * 2,
      dist: 30 + Math.random() * 25
    }));

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

    // Aura
    ctx.strokeStyle = "#00C8FF";
    ctx.lineWidth = 6;
    ctx.shadowColor = "#00C8FF";
    ctx.shadowBlur = 40;

    ctx.beginPath();
    ctx.arc(600, 400, 150, 0, Math.PI * 2);
    ctx.stroke();

    // Particles
    ctx.fillStyle = "#66DFFF";
    this.particles.forEach(p => {
      const ang = p.angle + t * 6;
      const px = 600 + Math.cos(ang) * (p.dist + t * 50);
      const py = 400 + Math.sin(ang) * (p.dist + t * 50);

      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Name
    ctx.font = "42px Rajdhani";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(this.name, 600, 400);

    ctx.restore();
  }
}
