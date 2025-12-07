// DiamondEffect.js — exploding blue-white shards

export default class DiamondEffect {
  constructor() {
    this.shards = [];
    this.count = 36;

    for (let i = 0; i < this.count; i++) {
      const ang = (i / this.count) * Math.PI * 2;
      this.shards.push({
        x: 600,
        y: 400,
        vx: Math.cos(ang) * (4 + Math.random() * 3),
        vy: Math.sin(ang) * (4 + Math.random() * 3),
        rot: Math.random() * 3
      });
    }

    this.duration = 900;
    this.start = performance.now();
    this.active = true;
  }

  isDone(now) {
    return now - this.start > this.duration;
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = "#BEE5FF";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#99DDFF";

    for (let s of this.shards) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);

      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();

      s.x += s.vx;
      s.y += s.vy;
      s.rot += 0.1;
    }

    ctx.restore();
  }
}
