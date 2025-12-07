// ============================================================================
// BombFX.js — Central Shockwave + Smoke Pulse
// ============================================================================

export default class BombFX {
  constructor() {
    this.time = 0;
    this.duration = 1.2;

    this.waves = [];
    this.maxWaves = 3;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;

    for (let i = 0; i < this.maxWaves; i++) {
      this.waves.push({
        delay: i * 0.15,
        life: 0,
        maxLife: 0.9,
      });
    }
  }

  update(dt) {
    this.time += dt;
    let alive = false;

    for (const w of this.waves) {
      if (this.time < w.delay) continue;

      w.life += dt;
      if (w.life < w.maxLife) alive = true;
    }

    return !alive;
  }

  render(ctx) {
    for (const w of this.waves) {
      if (this.time < w.delay) continue;

      const t = w.life / w.maxLife;
      const radius = 40 + t * 300;
      const alpha = 0.7 - t * 0.7;

      ctx.save();
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,150,0,${alpha})`;
      ctx.lineWidth = 8 - t * 7;
      ctx.stroke();
      ctx.restore();
    }
  }
}
