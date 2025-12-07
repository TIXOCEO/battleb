// ============================================================================
// SurvivorShieldFX.js — Blue Protective Pulsating Ring
// ============================================================================

export default class SurvivorShieldFX {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.time = 0;
    this.duration = 1.2;
  }

  setup() {}

  update(dt) {
    this.time += dt;
    return this.time >= this.duration;
  }

  render(ctx) {
    const t = this.time / this.duration;
    const radius = 50 + Math.sin(t * Math.PI) * 40;
    const alpha = 0.8 - t * 0.8;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,255,${alpha})`;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  }
}
