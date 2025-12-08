// ============================================================================
// MoneyGunFX — ULTRA MODE
// 120 bills • wobble physics • motion trails • air drag
// ============================================================================

export default class MoneyGunFX {
  constructor() {
    this.bills = [];

    for (let i = 0; i < 120; i++) {
      this.bills.push({
        x: 600,
        y: 400,
        vx: (Math.random() * 600) - 300,
        vy: -400 - Math.random() * 350,
        rot: Math.random() * Math.PI,
        wobble: Math.random() * 0.6,
        life: 1.8 + Math.random() * 0.6,
      });
    }
  }

  update(dt) {
    this.bills.forEach(b => {
      b.life -= dt;

      // movement
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // gravity
      b.vy += 550 * dt;

      // rotation wobble (air flutter)
      b.rot += dt * (3 + b.wobble * 3);

      // air drag
      b.vx *= 0.985;
      b.vy *= 0.985;
    });

    return this.bills.every(b => b.life <= 0);
  }

  render(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    this.bills.forEach(b => {
      if (b.life <= 0) return;

      const alpha = Math.max(0, b.life / 2);

      // trail
      ctx.strokeStyle = `rgba(0,255,0,${alpha * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
      ctx.stroke();

      // bill
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);

      ctx.fillStyle = `rgba(0,255,120,${alpha})`;
      ctx.fillRect(-35, -18, 70, 36);

      ctx.restore();
    });

    ctx.restore();
  }
}
