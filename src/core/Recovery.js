// src/core/Recovery.js
// Recuperación de Energía ENTRE partidos — ver DESIGN.md 7.11.5 (Bloque
// C.5 de la tarea de Alineaciones). Fuera del bucle de posesión (eso es
// Fatiga, MatchEngine.js/MatchConfig.js `fatigue`) — esto vive en el ciclo
// de calendario/temporada. Convención del proyecto: identificadores en
// inglés, comentarios en español.

(function (global) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Curva no lineal (DESIGN.md 7.11.5): decaimiento exponencial inverso
  // sobre el HUECO de energía restante (100 - energía actual) — más rápido
  // el primer día, progresivamente más lento en días sucesivos (propiedad
  // natural de una exponencial: la mayor parte de la recuperación absoluta
  // ocurre en los primeros días). El atributo Recuperación (1-20) es un
  // MULTIPLICADOR de velocidad (mismo punto final —siempre tiende a 100—,
  // se llega antes), referenciado contra el valor neutro de la escala.
  //
  // `trainingModifier`: gancho explícito para el futuro módulo de
  // Entrenamiento (DESIGN.md 7.11.5, todavía sin diseñar) — multiplica la
  // velocidad igual que Recuperación. Valor neutro (1) por defecto: no
  // implementar aquí ningún efecto real de tipo de entrenamiento.
  function computeRecoveredEnergy(currentEnergy, days, player, config, trainingModifier) {
    if (days <= 0) return currentEnergy;
    const gap = 100 - currentEnergy;
    if (gap <= 0) return 100;
    const recoveryAttr = player.physical.recovery;
    const speedMultiplier = recoveryAttr / config.recovery.recoveryAttributeReference;
    const modifier = trainingModifier === undefined ? config.recovery.trainingModifierDefault : trainingModifier;
    const decayRate = config.recovery.baseDecayPerDay * speedMultiplier * modifier;
    const remainingGap = gap * Math.exp(-decayRate * days);
    return clamp(100 - remainingGap, 0, 100);
  }

  // Aplica la recuperación a una lista de jugadores (plantilla completa de
  // un equipo, no solo los que jugaron) tras `days` días de descanso desde
  // su último partido. Muta dynamicState.energy de cada jugador in-place
  // (mismo patrón que Player.adjustEnergy).
  function applyRestRecovery(players, days, config, trainingModifier) {
    players.forEach((player) => {
      const recovered = computeRecoveredEnergy(
        player.dynamicState.energy, days, player, config, trainingModifier,
      );
      player.dynamicState.energy = recovered;
    });
  }

  const exportsObj = { computeRecoveredEnergy, applyRestRecovery };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
