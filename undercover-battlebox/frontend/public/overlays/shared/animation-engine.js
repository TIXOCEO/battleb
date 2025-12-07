// ============================================================================
// animation-engine.js — BattleBox AOE Engine v2.0 FINAL
// ============================================================================
//
// Nieuw in v2.0:
// ---------------------------------------
// ✔ "play(type, payload)" API geïntroduceerd
// ✔ Alle 11 effecten via factory automatisch geladen
// ✔ Multi-effect stacking (bijv. target + diamond + victims tegelijk)
// ✔ OBS-safe canvas scaling (auto-resize)
// ✔ Twist clear = canvas wipe
// ✔ Nooit overlappende loops / memory leaks
//
// ============================================================================

// EFFECT IMPORTS -------------------------------------------------------------
import CountdownEffect        from "/overlays/shared/effects/CountdownEffect.js";
import BombEffect             from "/overlays/shared/effects/BombEffect.js";
import MoneyGunEffect         from "/overlays/shared/effects/MoneyGunEffect.js";
import DiamondEffect          from "/overlays/shared/effects/DiamondEffect.js";
import HealEffect             from "/overlays/shared/effects/HealEffect.js";
import ImmuneAuraEffect       from "/overlays/shared/effects/ImmuneAuraEffect.js";

import TargetEffect           from "/overlays/shared/effects/TargetEffect.js";
import VictimBlastEffect      from "/overlays/shared/effects/VictimBlastEffect.js";
import SurvivorGlowEffect     from "/overlays/shared/effects/SurvivorGlowEffect.js";
import BreakerEffect          from "/overlays/shared/effects/BreakerEffect.js";
import GalaxyEffect           from "/overlays/shared/effects/GalaxyEffect.js";


// ============================================================================
// ANIMATION ENGINE CORE
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

    // layer background (transparant)
    this.backgroundColor = "rgba(0,0,0,0)";

    // autosize voor OBS scaling
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);

    this.resize();

    console.log("%c[AOE] Animation Engine ready v2.0", "color:#0fffd7");
  }

  // ==========================================================================
  // Resize canvas naar actuele CSS grootte (OBS belangrijk)
  // ==========================================================================
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  // ==========================================================================
  // Start loop
  // ==========================================================================
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

  // ==========================================================================
  // Stop loop (meestal niet gebruikt)
  // ==========================================================================
  stop() {
    this.running = false;
  }

  // ==========================================================================
  // Factory: maak juiste effect op basis van twist type
  // ==========================================================================
  createEffect(type, payload = {}) {
    switch (type) {
      case "countdown":
        return new CountdownEffect(payload.step);

      case "bomb":
        return new BombEffect();

      case "moneygun":
        return new MoneyGunEffect();

      case "diamond":
        return new DiamondEffect();

      case "heal":
        return new HealEffect();

      case "immune":
        return new ImmuneAuraEffect();

      case "target":
        return new TargetEffect(payload.targetName);

      case "victims":
        return new VictimBlastEffect(payload.victimNames || []);

      case "survivor":
        return new SurvivorGlowEffect(payload.survivorName);

      case "breaker":
        return new BreakerEffect();

      case "galaxy":
        return new GalaxyEffect(payload.reverse);

      default:
        console.warn("[AOE] Onbekend effect type:", type, payload);
        return null;
    }
  }

  // ==========================================================================
  // PLAY API — vanuit arena.js / twistStore
  // ==========================================================================
  play(type, payload = {}) {
    const fx = this.createEffect(type, payload);
    if (!fx) return;

    this.add(fx);
  }

  // ==========================================================================
  // Add effect instance
  // ==========================================================================
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

  // ==========================================================================
  // CLEAR — volledig canvas en effects leeg
  // ==========================================================================
  clear() {
    this.effects = [];
    const ctx = this.ctx;
    if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ==========================================================================
  // Update active effects
  // ==========================================================================
  update(dt) {
    this.effects = this.effects.filter((fx) => {
      try {
        // Effect klaar = update returns true
        const done = fx.update(dt);
        return !done;
      } catch (e) {
        console.error("[AOE] effect update error:", e);
        return false;
      }
    });
  }

  // ==========================================================================
  // Render effects
  // ==========================================================================
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
        console.error("[AOE] effect render error:", e);
      }
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================
const engine = new AnimationEngine("fx-canvas");
engine.start();

export default engine;
