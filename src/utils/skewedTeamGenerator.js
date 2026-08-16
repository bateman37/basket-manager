// src/utils/skewedTeamGenerator.js
// Herramienta de PRUEBA DE ESTRÉS del motor de simulación — NO es parte del
// juego final. Genera equipos "sesgados": todos los atributos Técnicos/
// Físicos/Mentales de sus jugadores comprimidos dentro de un rango
// concreto (ej. un "súper equipo" 16-20, o uno "flojo" 3-8), en vez del
// rango habitual del generador estándar (~10 ± variación). Reutiliza toda
// la lógica ya existente de generateFictionalTeam/generateFictionalPlayer
// — solo cambia el rango de atributos vía `attributeRange`
// (ver playerGenerator.js:generateSkewedAttributeGroup).

(function (global) {
  const TeamGenerator = (typeof module !== 'undefined' && module.exports)
    ? require('./teamGenerator.js')
    : global.BasketManager;

  const { generateFictionalTeam } = TeamGenerator;

  // `range`: { min, max } en escala 1-20 (ver Player.js: ATTRIBUTE_MIN/MAX).
  function generateSkewedTeam(range) {
    return generateFictionalTeam({ playerOptions: { attributeRange: range } });
  }

  const exportsObj = { generateSkewedTeam };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
