// ============================================================================
// SparkBurstFX.js — Quick Spark Explosion
// ============================================================================

export default class SparkBurstFX {
  constructor(x, y, color = "rgba(255,200,0,1)") {
    this.x = x;
    this.y = y;
    this.color = color;

    this.time = 0;
    this.duration = 0.35;

    this.sparks = [];
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 120;
      this.sparks.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: this.duration,
      });
    }
  }

  setup() {}

  update(dt) {
    this.time += dt;

    let alive = false;

    for (const s of this.sparks) {
      s.life += dt;
      if (s.life < s.maxLife) alive = true;

      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    return !alive;
  }

  render(ctx) {
    this.sparks.forEach((s) => {
      const alpha = 1 - s.life / s.maxLife;
      ctx.fillStyle = this.color.replace(",1)", `,${alpha})`);
      ctx.fillRect(s.x, s.y, 4, 4);
    });
  }
}
