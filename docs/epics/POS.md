# Ficha de Epic — mini-EPIC POS (posiciones, polivalencia, antropometría)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `POS`
- **Estado**: cerrada (histórica)
- **Objetivo**: Posiciones multi-mapa (1-20 por las 5 posiciones), polivalencia y modificador de envergadura.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/players-attributes.md`, `docs/design/match-simulation.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 3819-4058 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-22

### Mini-EPIC POS — Posiciones, polivalencia y antropometría

Entrega grande que toca `Player.js`, `playerGenerator.js`, `MatchConfig.js`,
`Rotation.js` (protegido — justificación: esta sesión de diseño cerrada),
`MatchEngine.js`, `Tactics.js`, `CpuLineup.js` y los 414 jugadores reales.
Todas las decisiones de diseño venían cerradas por Dennis en el prompt de
esta sesión; las únicas cifras sin confirmar explícitamente eran
`pureSkillPenaltyFraction` (se usó 0.2, valor de partida indicado en el
prompt) y el método de normalización de similitud de datos reales (usado
tal cual se especificaba).

#### 1. Núcleo de datos (`Player.js`)

- `buildPositionMap`: eliminada la exigencia de "exactamente una posición
  en 20" — el mapa de 5 posiciones puede tener 0, 1, 2 o más en 20.
- Nuevo campo `nominalPosition` (obligatorio, sin fallback silencioso):
  identidad posicional de ficha, asignada por el generador/migración,
  nunca derivada. Incluido en `toJSON()`.
- `primaryPosition` (getter) devuelve ahora directamente
  `nominalPosition` — mismo contrato de lectura, cero cambios para los 4
  usos existentes en `game.js` ni para `Team.buildMatchSquadExcludingPosition`.
- Nuevo `masteredPositions()`: array de posiciones con valor 20 (puede
  estar vacío).

#### 2. Generador de jugadores (`playerGenerator.js`)

- `POSITION_PROFILES` ahora exportado (reutilizado por el script del
  punto 8, sin duplicar la tabla).
- `generatePositionMap` reescrito: decide una `nominalPosition` explícita
  y un arquetipo de polivalencia (`POSITION_ARCHETYPE_WEIGHTS`,
  heurística de generación: especialista 60% / combo 30% /
  positionless 10%) — combo pone la ancla + una vecina adyacente en 20;
  positionless pone 3-4 posiciones en 17-20. Devuelve `{ map,
  nominalPosition }`; `generateFictionalPlayer` pasa ambos al `Player`.
- Modelo B de envergadura (7.4): envergadura relativa por encima de
  `config.positions.wingspanBiasThresholdCm` sesga (0-2 puntos,
  aleatorio, nunca determinista) `outsideShot` a la baja e
  `interiorDefense`/`blocking`/`offensiveRebound`/`defensiveRebound` al
  alza, en `generateAttributeGroup`/`generateSkewedAttributeGroup` —
  requiere `MatchConfig.CONFIG_BASE` (nueva dependencia: en Node se
  importa directo, en navegador se lee de `global.BasketManager` en
  tiempo de llamada porque `MatchConfig.js` carga después en
  `index.html`).

#### 3. `MatchConfig.js`

- Nueva sección `config.positions`: `competenceThresholds` (tramos de
  6.1), `competencePenaltyExponent` (1.6), `wingspanBiasThresholdCm` (8),
  `attributeCategory` (construido desde `Player.TECHNICAL_ATTRIBUTES` +
  `PHYSICAL_ATTRIBUTES` + `MENTAL_ATTRIBUTES`, sin duplicar la lista) y
  `pureSkillPenaltyFraction` (0.2).
- `emergencyVersatility`: fuera `basePenaltyByDistance`/
  `selectionDistanceWeight`; dentro `basePenalty` (6).
- `heightModifiers`: fuera `axis2ThresholdCm`/`axis2TaxPerCm`/
  `axis2MaxTax` (Eje 2 retirado). `axis1BonusPerCm`/`axis1MaxBonus`
  intactos.
- `heightAxis2` eliminado de las 4 acciones que lo declaraban
  (`threePointShot`, `midRangeShot`, `turnover`, `steal`), confirmado
  por grep antes de tocar.
- `actions.rebound.secondary`: añadido `anticipation` (0.15),
  redistribuyendo `defensiveRebound`/`jumping`/`positioning` para seguir
  sumando 1.
- `tactics.roles.fitWeights`: fuera `attributeMixWeight`/
  `positionLevelWeight`; dentro `positionShortfallThreshold` (14, mismo
  valor que `competenceThresholds.functionalMax` vía constante
  compartida `FUNCTIONAL_COMPETENCE_MAX`), `positionShortfallMaxPenalty`
  (4) y `positionShortfallExponent` (mismo valor que
  `competencePenaltyExponent` vía constante compartida
  `COMPETENCE_PENALTY_EXPONENT` — nunca duplicado como número suelto en
  dos sitios).

#### 4. `Rotation.js` (archivo protegido — justificación: esta sesión)

- `chooseEmergencyCandidate`: `score` pasa a ser directamente `level`
  (sin `distancia × peso`); desempate por minutos restantes sin cambios.
  La penalización devuelta pasa de escalar a objeto
  `{ responsibilityPenalty, pureSkillPenalty }` (fórmula de curva no
  lineal, 7.11.3).
- `getPenalty` devuelve por defecto `{ responsibilityPenalty: 0,
  pureSkillPenalty: 0 }` en vez de `0`.
- **Limpieza consecuencia directa del cambio** (no una decisión aparte):
  `positionDistance`/`positionIndex` y `referencePositionForPlayer`/
  `state.referencePosition` quedaban completamente muertos tras retirar
  la distancia geométrica de la selección — se eliminaron en vez de
  dejarlos sin uso, confirmado por grep que no los necesitaba nada más
  en el archivo ni fuera de él.

#### 5. `MatchEngine.js`

- `computeMixRating`: cambio de arquitectura central de la entrega — la
  penalización ya no se resta una vez al `rating` final; se resta POR
  ATRIBUTO dentro del propio bucle de la mezcla, según
  `config.positions.attributeCategory[atributo]`
  (`responsibilityPenalty` completa o `pureSkillPenalty` fraccionada).
- `applyHeightAxisModifiers`: eliminado el bloque de Eje 2 completo: la
  función solo aplica ya el Eje 1.
- Las ~8 llamadas existentes (`subtractProbability`,
  `computeEventProbability`, `rollDefensiveFoul`,
  `resolveFreeThrowsSequence`, `resolveReboundContest`...) siguen pasando
  el objeto de `getPenalty` sin cambios en su propia firma.
- **Interpretación señalada explícitamente** (no fijada en el prompt):
  `shotDefenderPenalty` combinaba antes un escalar de
  `getPenalty()` con `tacticalExtraShotDefenderPenalty` (penalización
  táctica de "defensor recuperándose", `config.tactics.advantage.
  recoveringDefenderPenalty`, 7.12.4) mediante una simple suma. Como
  `getPenalty()` ya no es un escalar, se creó
  `addTacticalResponsibilityPenalty()`: la penalización táctica se suma
  a `responsibilityPenalty` (nunca a `pureSkillPenalty`) porque un
  defensor "recuperándose" es un fallo de lectura/posicionamiento, misma
  naturaleza que esa categoría — no se crea un tercer canal de
  penalización paralelo.

#### 6. `Tactics.js`

- `roleFit`: la mezcla de atributos del rol (`mixScore`) pasa a ser la
  base del score; la competencia posicional actúa como techo con
  penalización acotada (`positionShortfallThreshold`/`MaxPenalty`/
  `Exponent`) en vez de sumarse ponderada — fórmula exacta de DESIGN.md
  7.12.9 (revisión mini-EPIC POS).

#### 7. `CpuLineup.js`

- `pickMatchSquadIds`: tras el reparto de `guaranteed` por posición, si
  el número de jugadores DISTINTOS es menor que 5 (un polivalente con 20
  en varias posiciones "ganó" más de una), busca para cada posición
  afectada el siguiente mejor candidato que no esté ya garantizado y lo
  añade también — no cambia nada para jugadores con una sola posición en
  20.

#### 8. Datos reales — `scripts/rebuild-real-positions-from-attributes.js` (nuevo)

- Deriva `nominalPosition` (= la posición que ya tenía valor 20, dato
  fiable) y las 4 posiciones secundarias de los 414 jugadores reales por
  SIMILITUD DE ATRIBUTOS contra `POSITION_PROFILES` (reutilizado del
  punto 2, sin duplicar) — nunca por investigación externa (decisión de
  producto explícita de Dennis para esta EPIC).
  Normalización: score = Σ(atributo-10)×peso del perfil, sumado sobre
  technical/physical/mental; los 4 scores no-nominales se normalizan a
  1-17 (rango 0 → los 4 reciben 9).
- Verificado: exactamente una posición en 20 tras el proceso en los 414
  jugadores; diff campo a campo confirma que solo cambiaron
  `positions`/`nominalPosition`; 10 ejemplos de al menos 3 equipos
  distintos impresos para revisión manual (bases con
  `ballHandling`/`passing` altos salen con Escolta secundaria alta y
  Pívot baja; interiores con `interiorDefense`/`offensiveRebound`/
  `strength` altos salen con Ala-pívot secundaria alta y Base baja —
  coherente a ojo).
- `migrate-positions-to-map.js`/`regenerate-real-positions.js` NO se
  tocaron ni se volvieron a ejecutar — quedan como artefactos históricos
  del CHANGELOG.
- Efecto colateral necesario: `scripts/import-real-data.js` ahora deriva
  `nominalPosition` (de la posición con valor 20 del propio fichero de
  origen) antes de instanciar `Player`, porque el constructor ya no lo
  admite ausente — sin esto el script de importación desde
  `data/real/sources/` habría quedado roto.

#### 9. DESIGN.md

- Bloques A-F del documento de actualización aplicados tal cual estaba
  redactado: 6.1 (mapa sin restricción de unicidad + `nominalPosition` +
  tramos + curva no lineal), 7.4 (Modificador de Envergadura, Eje 2
  retirado, Modelo B), 7.11.3 (penalización diferenciada por categoría de
  atributo), 7.12.9 (`roleFit` con techo por competencia), nota de
  posiciones secundarias de datos reales en la intro de la sección 6, y
  pendientes actualizados.
- **Discrepancia señalada explícitamente**: el Bloque F pedía sustituir
  una mención previa a "reconstrucción rigurosa de posiciones reales con
  fuentes externas" en los pendientes de 7.12.34 o el final de la
  sección 6/6.1 — no existía tal mención en ninguna sesión anterior de
  `DESIGN.md` (confirmado por grep). Se añadió igualmente la nota
  informativa de la decisión (tachada, "descartado por decisión de
  producto") en el bloque de pendientes de Simulación, junto a la nueva
  nota de calibración de `pureSkillPenaltyFraction`/exponente pedida en
  el mismo punto.

#### Verificación

- Script de scratchpad (no en el repo) con los 5 tests de estrés de la
  sesión de diseño — los 5 pasan:
  1. Out-of-position shooter: la caída de `outsideShot` (pureSkill) es
     exactamente `basePenalty × pureSkillPenaltyFraction`; la caída en
     una mezcla de `positioning`/`interiorDefense` (responsibility) es
     la penalización completa, varias veces mayor.
  2. Rodman test: probado en la orientación defensiva (base real de
     rebote defensivo ~72% ya favorece al defensor) — el reboteador
     bajo/medio con buenos atributos gana ~75-80% de los duelos contra
     un interior alto/envergadura larga pero mediocre. Señalado: en la
     orientación ofensiva (base ~28%) la anchor de `baseProbability`
     estructuralmente no deja superar el 50% salvo ventajas de rating
     extremas — no es un defecto de esta entrega, es una propiedad ya
     existente de la fórmula `ratio` de 7.6.8.
  3. Giant skilled guard (>215cm, Base=20/Escolta=20): sin penalización
     de Eje 2 (ya no existe); `roleFit` de Creador primario/PnR Handler
     en 4★ sin penalización por posición.
  4. Positionless unicorn (5 posiciones en 20): `Rotation`
     (`runSubstitutionWindow`/`chooseEmergencyCandidate` interno),
     `CpuLineup.buildCpuLineup` y `Tactics.roleFit` lo usan sin errores.
  5. Long-wingspan elite shooter: `outsideShot=19` con envergadura
     relativa +13cm sigue rindiendo en partido igual que su atributo real
     (el Modelo B solo afecta a generación, nunca a tiempo de partido).
- Instanciar con dos posiciones en 20 no lanza; `primaryPosition`
  devuelve `nominalPosition` aunque su nivel ahí no sea 20;
  `masteredPositions()` correcto en 0/1/2/5 casos; `nominalPosition`
  ausente lanza error explícito.
- 300 jugadores ficticios generados: los 3 arquetipos aparecen en
  proporciones cercanas a los pesos (especialista mayoritario);
  `nominalPosition` siempre presente; ninguna posición fuera de 1-20;
  `outsideShot` medio del tercio de mayor envergadura relativa por
  debajo del tercio de menor envergadura (sesgo del Modelo B visible pero
  no determinista).
- `pickMatchSquadIds` garantiza cobertura real de las 5 posiciones con un
  roster de prueba que incluye un jugador con 2 posiciones en 20.
- Grep confirmado: `heightAxis2`/`axis2*` no aparece en ningún sitio del
  código tras el cambio; tampoco `basePenaltyByDistance`/
  `selectionDistanceWeight`/`attributeMixWeight`/`positionLevelWeight`/
  `primaryCount`.
- Diff campo a campo de los 414 jugadores reales tras el script del
  punto 8 confirma que solo cambiaron `positions`/`nominalPosition`.
- **Suite de regresión existente**: `test-tactics-tac4.js`,
  `test-season-cycle.js`, `test-phase2.js`, `verify-real-data-import.js`
  no existen en el estado actual del repo (comprobado con `find`) — no
  hay nada que re-ejecutar de esa lista.
- **Regresión pre-existente detectada y NO introducida por esta entrega**
  (verificado comparando contra el estado del repo antes de esta EPIC vía
  `git stash`): `simulateMatch` con equipos de jugadores ficticios +
  alineaciones reales de `CpuLineup` puede lanzar `Cannot read properties
  of undefined (reading 'id')` en `simulatePossession` (`ballHandler`
  indefinido tras `planTacticalPossession`/`planSituationalPossession`).
  Reproducible igual en la rama base sin ningún cambio de esta sesión —
  señalado explícitamente para una sesión aparte, fuera de alcance de
  mini-EPIC POS.

#### Bloques pendientes

Ninguno — la entrega se completó de principio a fin en una sola sesión,
incluyendo la regeneración de los 414 jugadores reales y la actualización
de `DESIGN.md`.
