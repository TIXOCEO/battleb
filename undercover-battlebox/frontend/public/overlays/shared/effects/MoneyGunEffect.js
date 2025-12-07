// MoneyGunEffect.js — sprays green bills horizontally

export default class MoneyGunEffect {
  constructor() {
    this.bills = [];
    this.count = 26;

    for (let i = 0; i < this.count; i++) {
      this.bills.push({
        x: 600,
        y: 400,
        vx: 8 + Math.random() * 14,
        vy: -5 + Math.random() * 10,
        rot: (Math.random() - 0.5) * 0.6
      });
    }

    this.duration = 1000;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = "#00FF55";
    ctx.strokeStyle = "#008833";
    ctx.lineWidth = 2;

    for (let bill of this.bills) {
      ctx.save();
      ctx.translate(bill.x, bill.y);
      ctx.rotate(bill.rot);

      ctx.fillRect(-60, -20, 120, 40);
      ctx.strokeRect(-60, -20, 120, 40);

      ctx.restore();

      bill.x += bill.vx;
      bill.y += bill.vy;
      bill.vy += 0.3;
    }

    ctx.restore();
  }
}
