// src/entities/Player.js
// Entidad Jugador (ficha completa) — ver DESIGN.md sección 6.1.
// Convención del proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const ATTRIBUTE_MIN = 1;
  const ATTRIBUTE_MAX = 20;

  // Posiciones válidas — DESIGN.md 6.1: cada jugador tiene entre 1 y 5.
  const POSITIONS = ['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'];

  // Rasgos citados como ejemplo en DESIGN.md 6.1. No es una lista cerrada:
  // son etiquetas no numéricas, se puede añadir cualquier otra con addTrait().
  const TRAITS = [
    'Tirador clutch',
    'Especialista defensivo',
    'Generador de asistencias',
    'Chispa de banquillo',
    'Jugador de vestuario',
  ];

  // Atributos Técnicos — DESIGN.md 6.1 (fijos, mejoran con entrenamiento/edad).
  const TECHNICAL_ATTRIBUTES = [
    'outsideShot', // tiro exterior
    'midRangeShot', // tiro media distancia
    // 'insideShot' (tiro interior) y 'layup' (bandeja/finalización) son
    // campos DISTINTOS a propósito — DESIGN.md 6.1 lo remarca explícitamente
    // para que no se fusionen: tiro interior es tiro con arco cerca del aro
    // (poste, gancho, bote-parado); bandeja es ir a canasta en movimiento.
    'insideShot', // tiro interior
    'freeThrows', // tiro libre
    'layup', // bandeja/finalización
    'passing', // pase
    'ballHandling', // manejo de balón
    'offensiveRebound', // rebote ofensivo
    'defensiveRebound', // rebote defensivo
    'blocking', // tapón
    'stealing', // robo
    'foulTendency', // tendencia a falta (más alto = más propenso a pitarle falta)
    // Añadidos al implementar el motor de simulación (DESIGN.md 7.6, Bloque
    // A): varias fórmulas de acción (Triple, Media distancia, Tiro interior,
    // Bandeja, Pérdida de balón, Robo) usan "DefensaPerimetral"/
    // "DefensaInterior" como atributo defensivo, pero DESIGN.md 6.1 nunca
    // los había listado — confirmado con Dennis, se añaden aquí como
    // Atributos Técnicos y se documentan también en DESIGN.md 6.1.
    'perimeterDefense', // defensa perimetral (contención a tiradores/manejadores)
    'interiorDefense', // defensa interior (contención cerca del aro/poste)
  ];

  // Atributos Físicos — DESIGN.md 6.1 (fijos).
  const PHYSICAL_ATTRIBUTES = [
    'topSpeed', // velocidad punta
    'acceleration', // aceleración
    'jumping', // salto
    'strength', // fuerza
    'agility', // agilidad
    'balance', // balance (equilibrio/aguante al contacto)
    'stamina', // resistencia (aguante dentro de un partido)
    'recovery', // recuperación entre partidos/entrenamientos
    'durability', // durabilidad (propensión a lesión — sistema de lesiones pendiente, ver DESIGN.md 6.1)
  ];

  // Atributos Mentales — DESIGN.md 6.1 (fijos).
  // Profesionalidad y Ambición aparecen en esa misma lista de DESIGN.md, pero
  // la propia sección 6.1 las trata aparte en "Ocultos para el usuario" junto
  // a Potencial (se revelan por scouting). Para no duplicar el dato en dos
  // sitios, aquí viven solo dentro de `hidden` — ver más abajo.
  const MENTAL_ATTRIBUTES = [
    'gameVision', // visión de juego
    'pressureDecisionMaking', // decisión bajo presión
    'aggressiveness', // agresividad
    'concentration', // concentración
    'leadership', // liderazgo
    'teamwork', // trabajo en equipo
    'temperament', // temperamento
    'consistency', // consistencia
    'anticipation', // anticipación
    'positioning', // posicionamiento (movimiento sin balón)
    'workRate', // ética de trabajo
  ];

  // Atributos ocultos para el usuario — DESIGN.md 6.1: existen siempre en los
  // datos, el ocultamiento es cuestión de interfaz/scouting, no de que falten.
  const HIDDEN_ATTRIBUTES = [
    'potential', // potencial (techo de mejora)
    'professionalism', // profesionalidad
    'ambition', // ambición
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampAttribute(value) {
    return clamp(Math.round(value), ATTRIBUTE_MIN, ATTRIBUTE_MAX);
  }

  // Construye un grupo de atributos (technical/physical/mental/hidden)
  // rellenando con `defaultValue` cualquier clave no presente en `source`.
  function buildAttributeGroup(keys, source, defaultValue) {
    const group = {};
    keys.forEach((key) => {
      const raw = (source && source[key] !== undefined) ? source[key] : defaultValue;
      group[key] = clampAttribute(raw);
    });
    return group;
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'player-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  // Edad a partir de la fecha de nacimiento (DESIGN.md 6.1: se calcula, no se
  // guarda como número aparte). Se exporta también como función suelta para
  // que el generador de jugadores ficticios pueda usarla sin instanciar Player.
  function calculateAge(birthDate, referenceDate = new Date()) {
    if (!birthDate) return null;
    const birth = birthDate instanceof Date ? birthDate : new Date(birthDate);
    let age = referenceDate.getFullYear() - birth.getFullYear();
    const yaCumplioEsteAnio =
      referenceDate.getMonth() > birth.getMonth() ||
      (referenceDate.getMonth() === birth.getMonth() && referenceDate.getDate() >= birth.getDate());
    if (!yaCumplioEsteAnio) age -= 1;
    return age;
  }

  class Player {
    constructor(data = {}) {
      this.id = data.id || generateId();

      // --- Datos básicos ---
      this.firstName = data.firstName || '';
      this.lastName = data.lastName || '';
      this.birthDate = data.birthDate ? new Date(data.birthDate) : null;
      this.positions = Player.validatePositions(data.positions);

      // Relación con Team: id del equipo al que pertenece, o null si no
      // tiene equipo (ej. generación aislada, o futuros agentes libres).
      // Team.js es quien mantiene este campo sincronizado cuando el
      // jugador entra/sale de un roster — Player no se auto-asigna nada.
      this.teamId = data.teamId || null;

      // --- Datos Físicos Corporales (reales, no en escala 1-20) — DESIGN.md
      // 6.1. Distintos de los Atributos Físicos de más abajo (que son
      // habilidad/capacidad en escala 1-20): esto son medidas corporales
      // reales. Alimentarán directamente al futuro motor de simulación
      // (sección 7, todavía no implementado aquí) — de momento solo se
      // guarda el dato.
      const bodyMeasurements = data.bodyMeasurements || {};
      this.bodyMeasurements = {
        height: bodyMeasurements.height !== undefined ? bodyMeasurements.height : 190, // cm
        // Envergadura puede ser mayor que la altura, como en la realidad.
        wingspan: bodyMeasurements.wingspan !== undefined ? bodyMeasurements.wingspan : 193, // cm
        weight: bodyMeasurements.weight !== undefined ? bodyMeasurements.weight : 90, // kg
      };

      // --- Atributos fijos (escala 1-20) ---
      this.technical = buildAttributeGroup(TECHNICAL_ATTRIBUTES, data.technical, 10);
      this.physical = buildAttributeGroup(PHYSICAL_ATTRIBUTES, data.physical, 10);
      this.mental = buildAttributeGroup(MENTAL_ATTRIBUTES, data.mental, 10);

      // --- Rasgos: etiquetas no numéricas, no puntúan en escala 1-20 ---
      this.traits = Array.isArray(data.traits) ? [...new Set(data.traits)] : [];

      // --- Experiencia: campo aparte (ni atributo fijo ni estado dinámico).
      // Crece con partidos jugados, nunca decrece — por eso no hay setter
      // directo, solo addExperience() más abajo.
      this._experience = Math.max(0, data.experience || 0);

      // --- Atributos ocultos para el usuario (existen siempre; el
      // ocultamiento es cuestión de interfaz/scouting, no de datos ausentes) ---
      this.hidden = buildAttributeGroup(HIDDEN_ATTRIBUTES, data.hidden, 10);

      // --- Estados dinámicos ---
      // Los tres existen siempre y la simulación de temporada los actualiza
      // constantemente. Su visibilidad en la interfaz (aún sin construir) es,
      // según DESIGN.md 6.1:
      //   - energy: VISIBLE para el usuario.
      //   - competitionRhythm: SEMI-VISIBLE (se intuye, no se muestra el número).
      //   - momentum: NUNCA se muestra; solo lo usa la simulación internamente.
      const dynamicState = data.dynamicState || {};
      this.dynamicState = {
        energy: clamp(dynamicState.energy !== undefined ? dynamicState.energy : 100, 0, 100),
        competitionRhythm: clamp(dynamicState.competitionRhythm !== undefined ? dynamicState.competitionRhythm : 50, 0, 100),
        momentum: clamp(dynamicState.momentum !== undefined ? dynamicState.momentum : 0, -100, 100),
      };
    }

    static validatePositions(positions) {
      const list = Array.isArray(positions) ? positions : [positions];
      const valid = [...new Set(list.filter((p) => POSITIONS.includes(p)))];
      if (valid.length === 0) {
        throw new Error('Un jugador debe tener entre 1 y 5 posiciones válidas: ' + POSITIONS.join(', '));
      }
      return valid.slice(0, 5);
    }

    get fullName() {
      return `${this.firstName} ${this.lastName}`.trim();
    }

    get age() {
      return calculateAge(this.birthDate);
    }

    get experience() {
      return this._experience;
    }

    // Suma partidos/experiencia. Nunca decrece: cantidades negativas se ignoran.
    addExperience(amount) {
      if (amount > 0) {
        this._experience += amount;
      }
      return this._experience;
    }

    addTrait(trait) {
      if (!this.traits.includes(trait)) {
        this.traits.push(trait);
      }
    }

    // --- Actualización de estados dinámicos (delta puede ser + o -) ---
    adjustEnergy(delta) {
      this.dynamicState.energy = clamp(this.dynamicState.energy + delta, 0, 100);
    }

    adjustCompetitionRhythm(delta) {
      this.dynamicState.competitionRhythm = clamp(this.dynamicState.competitionRhythm + delta, 0, 100);
    }

    adjustMomentum(delta) {
      this.dynamicState.momentum = clamp(this.dynamicState.momentum + delta, -100, 100);
    }

    // Representación plana, útil para guardar partidas (saves/) más adelante.
    toJSON() {
      return {
        id: this.id,
        firstName: this.firstName,
        lastName: this.lastName,
        birthDate: this.birthDate ? this.birthDate.toISOString().slice(0, 10) : null,
        positions: this.positions,
        teamId: this.teamId,
        bodyMeasurements: this.bodyMeasurements,
        technical: this.technical,
        physical: this.physical,
        mental: this.mental,
        traits: this.traits,
        experience: this._experience,
        hidden: this.hidden,
        dynamicState: this.dynamicState,
      };
    }
  }

  const exportsObj = {
    Player,
    POSITIONS,
    TRAITS,
    TECHNICAL_ATTRIBUTES,
    PHYSICAL_ATTRIBUTES,
    MENTAL_ATTRIBUTES,
    HIDDEN_ATTRIBUTES,
    ATTRIBUTE_MIN,
    ATTRIBUTE_MAX,
    calculateAge,
  };

  // Funciona tanto en navegador (script clásico, sin build) como en Node
  // (scripts de utilidad futuros) — ver CLAUDE.md, sección "Stack técnico".
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
