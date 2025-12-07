// ============================================================================
// DiamondBlastFX.js — Blue Sharded Explosion
// ============================================================================

export default class DiamondBlastFX {
  constructor() {
    this.time = 0;
    this.duration = 1.4;

    this.shards = [];

    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 200;

      this.shards.push({
        x: 600,
        y: 400,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 6,
        life: 0,
        maxLife: 1 + Math.random() * 0.4,
      });
    }
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.time += dt;

    let alive = false;

    for (const s of this.shards) {
      s.life += dt;
      if (s.life < s.maxLife) alive = true;

      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.rotSpeed * dt;
    }

    return !alive;
  }

  render(ctx) {
    for (const s of this.shards) {
      const alpha = 1 - s.life / s.maxLife;

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);

      ctx.fillStyle = `rgba(0,180,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(8, 10);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }
}
