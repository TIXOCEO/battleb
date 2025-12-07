// ============================================================================
// MoneyGunFX — 40 biljetten schieten schuin omhoog
// ============================================================================

export default class MoneyGunFX {
  constructor() {
    this.particles = [];
    for (let i = 0; i < 40; i++) {
      this.particles.push({
        x: 600,
        y: 400,
        vx: (Math.random() * 300) - 150,
        vy: -300 - Math.random() * 200,
        rot: Math.random() * Math.PI,
        life: 1.4,
      });
    }
  }

  update(dt) {
    this.particles.forEach(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.rot += dt * 5;
    });
    return this.particles.every(p => p.life <= 0);
  }

  render(ctx) {
    ctx.save();
    this.particles.forEach(p => {
      if (p.life <= 0) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = "rgba(50,255,50,0.8)";
      ctx.fillRect(-15, -10, 30, 20);
      ctx.restore();
    });
    ctx.restore();
  }
}
