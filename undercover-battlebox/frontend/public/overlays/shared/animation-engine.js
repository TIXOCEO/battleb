// ============================================================================
// animation-engine.js — BattleBox AOE Engine v1.0 FINAL
// ============================================================================
//
// Definitieve AOE Canvas Engine:
// ✔ Geen CSS keyframes nodig
// ✔ 100% OBS safe (loopt altijd soepel)
// ✔ Effects als classes met update(dt) en render(ctx)
// ✔ Garbage-collection zodra effect klaar is
// ✔ Ondersteunt 100+ particles zonder frame drops
//
// ============================================================================

class AnimationEngine {
  constructor(canvasId = "fx-canvas") {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.warn("[AOE] Canvas niet gevonden:", canvasId);
      return;
    }

    this.ctx = this.canvas.getContext("2d");
    this.effects = [];

    this.lastTime = performance.now();
    this.running = false;

    this.backgroundColor = "rgba(0,0,0,0)";
    console.log("%c[AOE] Animation Engine ready", "color:#00fff6");
  }

  start() {
    if (this.running) return;
    this.running = true;

    const loop = (t) => {
      if (!this.running) return;

      const dt = (t - this.lastTime) / 1000;
      this.lastTime = t;

      this.update(dt);
      this.render();

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  add(effect) {
    if (!effect) return;

    try {
      if (typeof effect.setup === "function") {
        effect.setup(this.canvas, this.ctx);
      }
    } catch (e) {
      console.error("[AOE] setup error:", e);
    }

    this.effects.push(effect);
  }

  clear() {
    this.effects = [];
  }

  update(dt) {
    this.effects = this.effects.filter(fx => {
      try {
        return !fx.update(dt);
      } catch (e) {
        console.error("[AOE] update error:", e);
        return false;
      }
    });
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.backgroundColor) {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    for (const fx of this.effects) {
      try {
        fx.render(ctx);
      } catch (e) {
        console.error("[AOE] render error:", e);
      }
    }
  }
}

const engine = new AnimationEngine("fx-canvas");
engine.start();

export default engine;
