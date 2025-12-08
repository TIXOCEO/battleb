// ============================================================================
// DiamondBlastFX — ULTRA MODE
// 180 shards • neon glow • motion trails • spark breakup
// ============================================================================

export default class DiamondBlastFX {
  constructor() {
    this.shards = [];

    for (let i = 0; i < 180; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 350 + Math.random() * 450;

      this.shards.push({
        x: 600,
        y: 400,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.5 + Math.random() * 0.4,
        size: 3 + Math.random() * 3,
        trail: Math.random() * 0.6,
      });
    }
  }

  update(dt) {
    this.shards.forEach(s => {
      s.life -= dt;

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // friction
      s.vx *= 0.98;
      s.vy *= 0.98;
    });

    return this.shards.every(s => s.life <= 0);
  }

  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    this.shards.forEach(s => {
      if (s.life <= 0) return;

      const alpha = Math.max(0, s.life);
      const size = s.size;

      // motion trail
      ctx.strokeStyle = `rgba(0,220,255,${alpha * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03);
      ctx.stroke();

      // core shard
      ctx.fillStyle = `rgba(150,240,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }
}
