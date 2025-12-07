// ============================================================================
// BombFX — countdown → shockwave → rook
// ============================================================================

export default class BombFX {
  constructor() {
    this.t = 0;
    this.stage = 0;
  }

  setup(canvas) {
    this.cx = canvas.width / 2;
    this.cy = canvas.height / 2;
  }

  update(dt) {
    this.t += dt;

    // 0 → 3 seconden countdown (reeds gedaan via CountdownFX in arena.js)
    if (this.t < 0.1) return false;

    // STAGE 1: shockwave
    if (this.stage === 0 && this.t > 0.1) {
      this.stage = 1;
    }

    // STAGE 2: fade out rook
    if (this.t > 1.5) return true;

    return false;
  }

  render(ctx) {
    ctx.save();

    const p = Math.min(1, this.t / 1.2);

    // shockwave ring
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, p * 300, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,100,0,${1 - p})`;
    ctx.lineWidth = 25 * (1 - p);
    ctx.stroke();

    // rook
    ctx.fillStyle = `rgba(150,150,150,${0.4 * (1 - p)})`;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, 150 + p * 200, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
