// ============================================================================
// animation-engine.js — BattleBox AOE Engine v1.1 FINAL (NECESSARY FIXES ONLY)
// ============================================================================
//
// Fixes in v1.1 (no new features):
// ------------------------------------------------------------
// ✔ dt clamping (stabiliseert beams & galaxy op lage FPS)
// ✔ Canvas auto-resize (lost OBS fullscreen tearing op)
// ✔ Effect overflow guard (veilig bij >100 FX tegelijk)
// ✔ Hard-reset clear() (chaos & beams verdwijnen altijd)
// ✔ Render micro-sync fix (chromium smoothness)
//
// 100% backward compatible met alle bestaande FX classes.
// ============================================================================

class AnimationEngine {
  constructor(canvasId = "fx-canvas") {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.warn("[AOE] Canvas niet gevonden:", canvasId);
      return;
    }

    this.ctx = this.canvas.getContext("2d", { alpha: true });
    this.effects = [];

    this.lastTime = performance.now();
    this.running = false;

    this.backgroundColor = "rgba(0,0,0,0)";
    this.maxEffects = 180; // hard safety cap

    // Voor jitter-stabiliteit bij fullscreen gebruik
    this.resizeObserver = null;
    this.lastWidth = this.canvas.width;
    this.lastHeight = this.canvas.height;

    console.log("%c[AOE] Animation Engine ready (v1.1)", "color:#00fff6");
  }

  start() {
    if (this.running) return;
    this.running = true;

    // Canvas resize correction
    this.resizeObserver = new ResizeObserver(() => {
      this.syncCanvasSize();
    });
    this.resizeObserver.observe(this.canvas);

    const loop = (t) => {
      if (!this.running) return;

      let dt = (t - this.lastTime) / 1000;
      this.lastTime = t;

      // dt clamp → voorkomt beam/gflow jumps
      if (dt > 0.08) dt = 0.08;

      this.update(dt);

      // Micro-sync → chromium/OBS buttery smooth
      requestAnimationFrame(() => {
        this.render();
      });

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  syncCanvasSize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    if (w !== this.lastWidth || h !== this.lastHeight) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.lastWidth = w;
      this.lastHeight = h;
    }
  }

  add(effect) {
    if (!effect) return;

    // Effect overflow guard
    if (this.effects.length >= this.maxEffects) {
      console.warn("[AOE] FX overflow prevented");
      this.effects.splice(0, 20); // purge oldest 20
    }

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
    // Hard reset alle actieve effects
    this.effects.forEach((fx) => {
      if (fx.destroy) {
        try { fx.destroy(); } catch (e) {}
      }
    });
    this.effects = [];
  }

  update(dt) {
    this.effects = this.effects.filter((fx) => {
      try {
        return !fx.update(dt); // return true => keep
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
