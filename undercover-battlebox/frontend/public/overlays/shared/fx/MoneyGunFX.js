// ============================================================================
// MoneyGunFX.js — Dollar Bills Spray
// ============================================================================

export default class MoneyGunFX {
  constructor() {
    this.time = 0;
    this.duration = 2;

    this.particles = [];
    for (let i = 0; i < 40; i++) {
      this.particles.push({
        x: 200,
        y: 400,
        vx: 300 + Math.random() * 250,
        vy: -200 + Math.random() * 150,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 4,
        life: 0,
        maxLife: 1 + Math.random(),
      });
    }
  }

  setup(canvas) {
    this.canvas = canvas;
  }

  update(dt) {
    this.time += dt;

    let alive = false;

    for (const b of this.particles) {
      b.life += dt;
      if (b.life < b.maxLife) alive = true;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += 180 * dt; // gravity
      b.rot += b.rotSpeed * dt;
    }

    return !alive;
  }

  render(ctx) {
    ctx.save();

    for (const b of this.particles) {
      const alpha = 1 - b.life / b.maxLife;

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);

      ctx.fillStyle = `rgba(0,255,80,${alpha})`;
      ctx.fillRect(-20, -10, 40, 20);

      ctx.restore();
    }

    ctx.restore();
  }
}
