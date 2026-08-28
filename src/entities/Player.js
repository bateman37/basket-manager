// src/entities/Player.js
// Entidad Jugador (ficha completa) — ver DESIGN.md sección 6.1.
// Convención del proyecto: identificadores en inglés, comentarios en español.

(function (global) {
  const ATTRIBUTE_MIN = 1;
  const ATTRIBUTE_MAX = 20;

  // Posiciones — DESIGN.md 6.1 (actualizado): cada jugador tiene un MAPA con
  // nivel 1-20 para las 5, SIEMPRE presentes (nunca una lista variable de 1
  // a 5 entradas como antes). La posición principal se deduce de cuál de
  // las 5 tiene valor 20 (exactamente una, por definición).
  const POSITIONS = ['Base', 'Escolta', 'Alero', 'Ala-pívot', 'Pívot'];
  const PRIMARY_POSITION_LEVEL = 20;

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
  //
  // LIFE-1 (DESIGN.md 9): `potential` YA NO vive en esta lista genérica.
  // Motivo (ver CHANGELOG de la sesión LIFE-1): `buildAttributeGroup()`
  // aplica `clampAttribute()` (clamp 1-20) a cualquier campo de esta lista
  // DENTRO del propio constructor — si `potential` siguiera aquí, cualquier
  // valor legacy migrado a la escala nueva (1-200) se recortaría a 20 antes
  // de que la migración pudiera actuar. `potential` se construye aparte más
  // abajo (`migratePotentialRaw`), con su propio clamp 1-200.
  const HIDDEN_ATTRIBUTES = [
    'professionalism', // profesionalidad
    'ambition', // ambición
  ];

  // LIFE-1 (DESIGN.md 9, sección 6 del prompt de esta sesión): learningRate/
  // learningPersistence también quedan FUERA de buildAttributeGroup, pero
  // por un motivo distinto a `potential` (su escala sigue siendo 1-20, no
  // cambia) — necesitan generarse de forma determinista a partir de
  // `developmentState.developmentSeed` la primera vez que faltan, y
  // buildAttributeGroup solo sabe rellenar con un valor FIJO por defecto
  // (10), no generar con seed. Aquí se dejan en `null` si no vienen
  // informados; `PlayerDevelopment.ensureDevelopmentState()` es quien los
  // genera una sola vez y los persiste (nunca se generan aquí, el
  // constructor de Player no conoce CONFIG ni el seed todavía en ese punto).
  const LEARNING_HIDDEN_ATTRIBUTES = ['learningRate', 'learningPersistence'];

  // Escala interna de Potencial tras LIFE-1: 1-200 (antes 1-20). Migración
  // (DESIGN.md 9, sección 5 del prompt de esta sesión): un valor <= 20 se
  // interpreta como legacy y se multiplica ×10; > 20 ya está en escala
  // nueva y se conserva tal cual. Idempotente (15 -> 150 una vez; 150 -> 150
  // al recargar). El suelo "PA nunca por debajo del TMB actual" (invariante
  // 13) NO se aplica aquí — Player.js no conoce PlayerDevelopment.js a
  // propósito (evita una dependencia circular: PlayerDevelopment.js sí
  // necesita requerir Player.js para sus catálogos de atributos) — lo
  // aplica `PlayerDevelopment.ensureDevelopmentState()` en cada punto de
  // integración, con acceso a CONFIG y a la fórmula completa de TMB.
  function migratePotentialRaw(raw) {
    if (raw === undefined || raw === null) return null; // sin dato -> se generará en PlayerDevelopment
    const canonical = raw <= 20 ? raw * 10 : raw;
    return clamp(Math.round(canonical), 1, 200);
  }

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
  //
  // CYCLE-1 (DESIGN.md 9.22, BUG-CYCLE1-01) — LEGACY / SOLO MODO PRUEBA:
  // el valor por defecto `new Date()` es el reloj REAL del ordenador, no la
  // fecha de la carrera. Cualquier flujo de carrera (core, UI de partida,
  // seeders, retiro, mercado, planificación, CPU) debe usar
  // `CareerAge.ageOn()/ageOnDate()` (src/utils/CareerAge.js) con la fecha
  // civil explícita del hecho que resuelve. Esta función y el getter
  // `player.age` de abajo se conservan únicamente por compatibilidad con el
  // "modo prueba" del motor de `index.html` y quedan auditados
  // estáticamente en `scripts/test-cycle1.js`.
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
      this.positions = Player.buildPositionMap(data.positions);

      // Posición nominal (DESIGN.md 6.1, revisión mini-EPIC POS): identidad
      // posicional habitual/de ficha, asignada por el generador o la
      // migración de datos reales — NUNCA derivada ni inferida aquí. Puede
      // diferir de cuáles posiciones tienen valor 20 en el mapa (un
      // jugador puede tener 0, 1, 2 o más posiciones en 20).
      if (!POSITIONS.includes(data.nominalPosition)) {
        throw new Error(
          `nominalPosition debe ser una de las 5 posiciones (DESIGN.md 6.1): ${POSITIONS.join(', ')}`,
        );
      }
      this.nominalPosition = data.nominalPosition;

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
      // LIFE-1: potential (1-200, ver migratePotentialRaw arriba) y
      // learningRate/learningPersistence (1-20, `null` si faltan — los
      // genera PlayerDevelopment.ensureDevelopmentState) viven fuera de
      // buildAttributeGroup, cada uno por su propio motivo (ver comentarios
      // en las constantes de arriba).
      this.hidden.potential = migratePotentialRaw(data.hidden && data.hidden.potential);
      LEARNING_HIDDEN_ATTRIBUTES.forEach((key) => {
        const raw = data.hidden && data.hidden[key];
        this.hidden[key] = (raw === undefined || raw === null) ? null : clampAttribute(raw);
      });

      // --- Estado de desarrollo de carrera (LIFE-1, DESIGN.md 9) ---
      // Separado a propósito de `dynamicState` (más abajo): dynamicState es
      // estado de PARTIDO/temporada corta (energía, ritmo, momentum);
      // developmentState es estado de CARRERA a largo plazo. `null` hasta
      // que `PlayerDevelopment.ensureDevelopmentState()` lo inicializa (no
      // se inicializa aquí: Player.js no conoce CONFIG ni las reglas de
      // desarrollo, ver cabecera de PlayerDevelopment.js) — si los datos ya
      // traían un developmentState serializado (partida guardada), se
      // conserva tal cual.
      this.developmentState = data.developmentState || null;

      // --- Estado médico de carrera (LIFE-3, DESIGN.md 9.14) ---
      // Separado a propósito de `dynamicState` (Energy) y de
      // `developmentState` (TMB/PA/atributos): esto es lesión/tejido/
      // disponibilidad, nunca crecimiento normal ni batería física. `null`
      // hasta que `Medical.ensureMedicalState()` lo inicializa (mismo
      // patrón que `developmentState` arriba) — si los datos ya traían un
      // medicalState serializado (partida guardada), se conserva tal cual.
      this.medicalState = data.medicalState || null;

      // --- Histórico de carrera (LIFE-4, DESIGN.md 9.15) ---
      // Separado a propósito de `dynamicState`/`developmentState`/
      // `medicalState`: esto es histórico de TEMPORADAS ya cerradas +
      // temporada en curso + hitos/récords/honores, nunca estado vivo de
      // partido/desarrollo/lesión (esos siguen siendo la fuente de verdad,
      // este bloque solo los fotografía al cierre de cada temporada). `null`
      // hasta que `PlayerCareer.ensureCareerHistory()` lo inicializa (mismo
      // patrón que `developmentState`/`medicalState` arriba) — si los datos
      // ya traían un careerHistory serializado (partida guardada), se
      // conserva tal cual.
      this.careerHistory = data.careerHistory || null;

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
        // Fecha real del último partido jugado (DESIGN.md 7.11.5, cierre de
        // integración) — null hasta que el jugador debuta en la temporada.
        // La usa Recovery.js/game.js para calcular los días de descanso
        // reales entre partidos de CADA jugador (no de la jornada del
        // calendario, que puede no coincidir si el jugador se saltó alguna).
        lastMatchDate: dynamicState.lastMatchDate ? new Date(dynamicState.lastMatchDate) : null,
      };
    }

    // Construye/valida el mapa de 5 posiciones (DESIGN.md 6.1, revisión
    // mini-EPIC POS): las 5 claves SIEMPRE presentes, nivel 1-20 cada una.
    // Ya NO se exige exactamente una posición en 20 — puede haber 0, 1, 2 o
    // más (especialista puro, positionless...), ver `nominalPosition` para
    // la identidad posicional de ficha. `positions` debe ser ya un mapa
    // completo — el generador y cualquier código que cree jugadores es
    // responsable de construirlo así (no se acepta la lista plana antigua
    // ni se completa aquí con valores por defecto silenciosos).
    static buildPositionMap(positions) {
      if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
        throw new Error(
          'positions debe ser un mapa con las 5 posiciones y nivel 1-20 cada una (DESIGN.md 6.1): '
          + POSITIONS.join(', '),
        );
      }
      const map = {};
      POSITIONS.forEach((pos) => {
        const raw = positions[pos];
        if (raw === undefined || raw === null) {
          throw new Error(`positions no incluye la posición "${pos}" — las 5 deben estar siempre presentes`);
        }
        map[pos] = clampAttribute(raw);
      });
      return map;
    }

    get fullName() {
      return `${this.firstName} ${this.lastName}`.trim();
    }

    // Posición principal (DESIGN.md 6.1, revisión mini-EPIC POS): mismo
    // nombre/contrato de lectura de siempre, pero ahora devuelve
    // directamente `nominalPosition` — ya no se deduce de cuál posición
    // tiene valor 20 (puede haber 0, 1, 2 o más).
    get primaryPosition() {
      return this.nominalPosition;
    }

    // Nivel de competencia (1-20) del jugador en una posición concreta.
    positionLevel(position) {
      return this.positions[position];
    }

    // Posiciones con dominio completo (nivel 20) — DESIGN.md 6.1, revisión
    // mini-EPIC POS: propiedad derivada del mapa, no un campo declarado
    // aparte. Puede estar vacío (ningún especialista total) o tener varias
    // (positionless).
    masteredPositions() {
      return POSITIONS.filter((pos) => this.positions[pos] === PRIMARY_POSITION_LEVEL);
    }

    // Medias de grupo de atributos (1-20) — DESIGN.md 7.11.6, pantalla de
    // Alineación ("Valoración Técnica/Física/Mental").
    get technicalAverage() {
      return TECHNICAL_ATTRIBUTES.reduce((sum, key) => sum + this.technical[key], 0) / TECHNICAL_ATTRIBUTES.length;
    }

    get physicalAverage() {
      return PHYSICAL_ATTRIBUTES.reduce((sum, key) => sum + this.physical[key], 0) / PHYSICAL_ATTRIBUTES.length;
    }

    get mentalAverage() {
      return MENTAL_ATTRIBUTES.reduce((sum, key) => sum + this.mental[key], 0) / MENTAL_ATTRIBUTES.length;
    }

    // CYCLE-1 (BUG-CYCLE1-01) — LEGACY: lee el reloj REAL del ordenador.
    // Prohibido en el flujo de carrera (ver nota en `calculateAge` arriba);
    // usa `CareerAge.ageOnDate(player, fechaDeCarrera)`.
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

    // Registra la fecha real del partido que el jugador ACABA de jugar
    // (DESIGN.md 7.11.5, cierre de integración) — la llama game.js tras
    // resolver cada partido, para cada jugador con minutos jugados. No hace
    // ningún cálculo de recuperación aquí (eso es Recovery.js, ciclo de
    // calendario/temporada, no una acción del propio jugador).
    recordMatchDate(date) {
      this.dynamicState.lastMatchDate = date;
    }

    // Representación plana, útil para guardar partidas (saves/) más adelante.
    toJSON() {
      return {
        id: this.id,
        firstName: this.firstName,
        lastName: this.lastName,
        birthDate: this.birthDate ? this.birthDate.toISOString().slice(0, 10) : null,
        positions: this.positions,
        nominalPosition: this.nominalPosition,
        teamId: this.teamId,
        bodyMeasurements: this.bodyMeasurements,
        technical: this.technical,
        physical: this.physical,
        mental: this.mental,
        traits: this.traits,
        experience: this._experience,
        hidden: this.hidden,
        // LIFE-1: developmentState completo (seed/residuales/matchExposures/
        // agingOffsetYears/lastProcessedDate) — invariante 14, "guardar/
        // cargar conserva residuals/seed/nuevos hidden". `null` si todavía
        // no se ha inicializado (jugador nunca tocado por PlayerDevelopment,
        // ver comentario en el constructor).
        developmentState: this.developmentState ? {
          ...this.developmentState,
          lastProcessedDate: this.developmentState.lastProcessedDate
            ? new Date(this.developmentState.lastProcessedDate).toISOString() : null,
          matchExposures: this.developmentState.matchExposures.map((exp) => ({
            ...exp,
            date: exp.date ? new Date(exp.date).toISOString() : null,
          })),
        } : null,
        // LIFE-3 (DESIGN.md 9.14, invariante 5): currentInjury/injuryHistory/
        // loadHistory sobreviven toJSON()/reconstrucción — mismas fechas
        // serializadas a ISO que el resto de esta ficha.
        medicalState: this.medicalState ? {
          ...this.medicalState,
          lastProcessedDate: this.medicalState.lastProcessedDate
            ? new Date(this.medicalState.lastProcessedDate).toISOString() : null,
          lastTrainingTickDate: this.medicalState.lastTrainingTickDate
            ? new Date(this.medicalState.lastTrainingTickDate).toISOString() : null,
          currentInjury: this.medicalState.currentInjury ? {
            ...this.medicalState.currentInjury,
            occurredAt: this.medicalState.currentInjury.occurredAt
              ? new Date(this.medicalState.currentInjury.occurredAt).toISOString() : null,
            lastProcessedDate: this.medicalState.currentInjury.lastProcessedDate
              ? new Date(this.medicalState.currentInjury.lastProcessedDate).toISOString() : null,
          } : null,
          injuryHistory: this.medicalState.injuryHistory.map((entry) => ({
            ...entry,
            occurredAt: entry.occurredAt ? new Date(entry.occurredAt).toISOString() : null,
            recoveredAt: entry.recoveredAt ? new Date(entry.recoveredAt).toISOString() : null,
          })),
          loadHistory: this.medicalState.loadHistory.map((entry) => ({
            ...entry,
            date: entry.date ? new Date(entry.date).toISOString() : null,
          })),
        } : null,
        // LIFE-4 (DESIGN.md 9.15): careerHistory completo (baseline/
        // temporada en curso/temporadas cerradas/hitos/récords) sobrevive
        // toJSON()/reconstrucción — mismo criterio de fechas ISO que el
        // resto de esta ficha.
        careerHistory: this.careerHistory ? {
          ...this.careerHistory,
          historyStartDate: this.careerHistory.historyStartDate
            ? new Date(this.careerHistory.historyStartDate).toISOString() : null,
          baseline: {
            ...this.careerHistory.baseline,
            date: this.careerHistory.baseline.date ? new Date(this.careerHistory.baseline.date).toISOString() : null,
          },
          currentSeason: {
            ...this.careerHistory.currentSeason,
            startDate: this.careerHistory.currentSeason.startDate
              ? new Date(this.careerHistory.currentSeason.startDate).toISOString() : null,
          },
          seasons: this.careerHistory.seasons.map((season) => ({
            ...season,
            endDate: season.endDate ? new Date(season.endDate).toISOString() : null,
          })),
          milestones: this.careerHistory.milestones.map((milestone) => ({
            ...milestone,
            date: milestone.date ? new Date(milestone.date).toISOString() : null,
          })),
          personalBests: Object.fromEntries(Object.entries(this.careerHistory.personalBests).map(([key, pb]) => ([
            key, { ...pb, date: pb.date ? new Date(pb.date).toISOString() : null },
          ]))),
        } : null,
        dynamicState: {
          ...this.dynamicState,
          // CAL-1 (DESIGN.md 3.3.1/6, decisión de Recovery): `lastMatchDate`
          // ahora lleva una hora real con significado (horario real de
          // partido, ver Calendar.js) — antes de esta entrega se truncaba a
          // solo fecha aquí ("consistencia de guardado"), lo que habría
          // destruido esa hora en cualquier guardado/carga futuro y
          // desincronizado el cálculo de días de descanso justo después de
          // cargar una partida. Se serializa como ISO completo; `birthDate`
          // (sin significado horario) sigue truncado a solo fecha arriba.
          lastMatchDate: this.dynamicState.lastMatchDate ? this.dynamicState.lastMatchDate.toISOString() : null,
        },
      };
    }
  }

  const exportsObj = {
    Player,
    POSITIONS,
    PRIMARY_POSITION_LEVEL,
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
