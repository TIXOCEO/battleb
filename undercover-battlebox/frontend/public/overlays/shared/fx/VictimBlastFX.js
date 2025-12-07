// ============================================================================
// VictimBlastFX.js — Red/Orange Shock Particles
// ============================================================================

export default class VictimBlastFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.particles = [];
    this.spawnParticles();
  }

  setup() {}

  spawnParticles() {
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 220;
      this.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.3,
      });
    }
  }

  update(dt) {
    let alive = false;

    for (const p of this.particles) {
      p.life += dt;
      if (p.life < p.maxLife) alive = true;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    return !alive;
  }

  render(ctx) {
    for (const p of this.particles) {
      const alpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = `rgba(255,60,0,${alpha})`;
      ctx.fillRect(p.x, p.y, 6, 6);
    }
  }
}
