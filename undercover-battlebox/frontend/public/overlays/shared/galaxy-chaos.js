// ============================================================================
// galaxy-chaos.js — DOM Manager for GalaxyChaosFX (v1.0 FINAL)
// ============================================================================
//
// Dit bestand vult de ontbrekende enable/disable API in die arena.js verwacht.
// GalaxyChaosFX doet het canvas effect, maar deze manager regelt:
//
//  ✔ seeds genereren voor smooth randomness (geen jumping)
//  ✔ FX instance registreren in animation-engine
//  ✔ correcte cleanup (transform + filter reset)
//  ✔ nooit dubbele instances
//
// ============================================================================

import FX from "/overlays/shared/animation-engine.js";
import GalaxyChaosFX from "/overlays/shared/fx/GalaxyChaosFX.js";

// Actieve instantie (voorkomt dubbele chaos)
let chaosInstance = null;

/**
 * Initialiseer de chaos visuals voor alle kaarten.
 */
export function enableGalaxyChaos(cardRefs, root = document.body) {
  // Als er al een actief effect draait → eerst opruimen
  if (chaosInstance) {
    disableGalaxyChaos(cardRefs);
  }

  // Seeds toevoegen aan elke kaart — nodig voor consistente jitter
  cardRefs.forEach((ref, i) => {
    if (!ref?.el) return;

    ref.el.dataset.seedX = Math.random() * 10;
    ref.el.dataset.seedY = Math.random() * 10;
    ref.el.dataset.seedR = Math.random() * 10;
  });

  // GalaxyChaosFX starten
  chaosInstance = new GalaxyChaosFX(cardRefs, root);
  FX.add(chaosInstance);
}

/**
 * Stop de chaos mode en herstel alle playercards.
 */
export function disableGalaxyChaos(cardRefs) {
  if (!chaosInstance) return;

  try {
    // Canvas effect netjes stoppen & cleanup
    chaosInstance.destroy();
  } catch (e) {
    console.warn("[GalaxyChaos] destroy() error:", e);
  }

  chaosInstance = null;

  // DOM transforms resetten
  cardRefs.forEach((ref) => {
    if (!ref?.el) return;
    ref.el.style.transform = "";
    ref.el.style.filter = "";
  });
}
