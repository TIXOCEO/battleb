
// ============================================================================
// DiamondBlastFX — 60 diamant-scherven die vanuit het midden vliegen
// ============================================================================

export default class DiamondBlastFX {
  constructor() {
    this.shards = [];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 250 + Math.random() * 300;
      this.shards.push({
        x: 600,
        y: 400,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1.2,
      });
    }
  }

  update(dt) {
    this.shards.forEach(s => {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    });
    return this.shards.every(s => s.life <= 0);
  }

  render(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(0,200,255,0.9)";
    this.shards.forEach(s => {
      if (s.life <= 0) return;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
}
