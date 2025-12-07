// ============================================================================
// animation-engine.js — BattleBox AOE Engine v1.0 FINAL
// ============================================================================
//
// Dit is de volledige nieuwe animatie-engine die ALLE twist-animaties,
// countdowns, target flashes, moneygun, bomb, diamond shards, survivors enz.
// gaat aansturen.
//
// • Geen CSS keyframes meer
// • 100% OBS safe (loopt altijd door, nooit vast)
// • Effects zijn classes met update(dt) en render(ctx)
// • Meerdere effects tegelijk ondersteund
// • Auto-garbage-collection van voltooide animaties
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

    // actieve effecten
    this.effects = [];

    // voor timing
    this.lastTime = performance.now();
    this.running = false;

    // layers
    this.backgroundColor = "rgba(0,0,0,0)";

    console.log("%c[AOE] Animation Engine ready", "color:#0fffd7");
  }

  // --------------------------------------------------------------------------
  // Start de engine loop
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Stop de engine
  // --------------------------------------------------------------------------
  stop() {
    this.running = false;
  }

  // --------------------------------------------------------------------------
  // Voeg een effect toe
  // effect = instance van een effect class
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Verwijder ALLE effecten
  // --------------------------------------------------------------------------
  clear() {
    this.effects = [];
  }

  // --------------------------------------------------------------------------
  // Update loop — laat elk effect zijn tijd verbruiken
  // --------------------------------------------------------------------------
  update(dt) {
    // filter: effects waarvan update() true retour geeft zijn klaar
    this.effects = this.effects.filter((fx) => {
      try {
        const done = fx.update(dt);
        return !done;
      } catch (e) {
        console.error("[AOE] effect update error:", e);
        return false; // verwijderen wegens error
      }
    });
  }

  // --------------------------------------------------------------------------
  // Render alle effecten in volgorde
  // --------------------------------------------------------------------------
  render() {
    const ctx = this.ctx;
    if (!ctx) return;

    // volledige canvas leegmaken
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // achtergrond (altijd transparant)
    if (this.backgroundColor) {
      ctx.fillStyle = this.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // effects renderen
    for (const fx of this.effects) {
      try {
        fx.render(ctx);
      } catch (e) {
        console.error("[AOE] effect render error:", e);
      }
    }
  }
}

// ============================================================================
// Singleton export
// ============================================================================
const engine = new AnimationEngine("fx-canvas");
engine.start();

export default engine;
