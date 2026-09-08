# Ficha de Epic — CONTRACT-1 (contrato profesional)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `CONTRACT-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Contrato profesional, vigencia, salario y cláusulas.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/contracts.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2614-2862 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-26 — CONTRACT-1: contrato profesional, vigencia, salario y cláusulas (DESIGN.md 9.17)

Segunda entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → **CONTRACT-1** → REG-1 → MARKET-1 → TRANSFER-1 → LOAN-1 →
CYCLE-1 → EUROPE-1 → HARDEN-1). Base: ROSTER-1 (commit 745e8d8, ya
fusionada en `main`). Esta entrega crea la relación LABORAL canónica entre
club y jugador: vigencia, remuneración, calendario de pagos, garantía,
periodo de prueba, cláusulas tipadas, registro contractual explícito,
jurisdicción del empleador y trazabilidad normativa completa.

En esta PR los contratos se **crean, validan, consultan, proyectan y
visualizan**; todavía **no** se firman, renuevan, rescinden ni ejecutan
desde botones de usuario.

### Bugs heredados corregidos

- **BUG-ROSTER1-01 — el resolver temporal ignoraba la temporada
  solicitada.** `resolveBundle()` recibía `seasonKey` pero, sin `bundleId`,
  elegía el bundle de **versión más alta**: un bundle con vigencia 2030-31
  se aplicaba a 2026-27 sin `resolutionMode` ni warning (reproducido antes
  del fix; ahora es un test de regresión en
  `scripts/test-contract1.js`). Ahora cada `RuleModule`/`RulesetBundle`
  declara `validity` (`seasonFrom`/`seasonTo`/`dateFrom`/`dateTo` +
  `carryForwardUntilSuperseded`) y la selección es por temporada y/o fecha
  solicitada. Sin coincidencia exacta no hay fallback silencioso: solo
  continúa quien lo declare en datos, con
  `resolutionMode: 'provisionalCarryForward'`, warning y traza; una norma
  futura nunca actúa retroactivamente; una `deprecated` solo resuelve un
  histórico FIJADO; temporada/fecha sin cobertura → error descriptivo,
  nunca ACB por defecto.
- **BUG-ROSTER1-02 — la jurisdicción laboral colgaba de la competición.**
  El bundle ACB declaraba `jurisdictionId: 'es-professional-sport'` para
  sus 18 clubes, pero **MoraBanc Andorra compite en ACB con el empleador
  domiciliado en Andorra**. Corregido: `CompetitionDefinition.country` →
  **`organizerCountry`** (nunca jurisdicción laboral), el bundle de
  competición ya no declara jurisdicción y solo puede aportar un overlay de
  convenio/membresía, y la jurisdicción del empleador vive en el nuevo
  `ClubEmploymentContextCatalog.js` con `employerJurisdictionId` explícito
  para **los 36 clubes** (35 ES + 1 AD).
- **BUG-ROSTER1-03 — verificación Playwright intermitente.**
  `verify-roster1-playwright.js` pulsaba el primer nombre de la Alineación,
  que podía ser un jugador de relleno ficticio (`Math.random`) y hacer
  fallar la comprobación de BUG-LIFE4-01 sin regresión real. Ahora elige
  explícitamente un jugador REAL (3/3 ejecuciones estables).
- **Corrección documental**: los comentarios de ROSTER-1 que situaban
  "jugadores vinculados" en CONTRACT-1 se corrigen — la vinculación es de
  REG-1 (y de LOAN-1 cuando exista relación laboral temporal).

### Arquitectura normativa multi-dominio (mismo motor, no un segundo)

`CompetitionRules.resolveRules(context)` sigue siendo el punto de entrada
único y ahora acepta `domain: 'registration' | 'employment'`;
`resolveEmploymentRules()` es solo un wrapper fino. El empleo se resuelve
por club + jurisdicción del empleador + competición doméstica + federación
+ temporada + fecha, nunca por "la competición del próximo partido".

Capas activas: FIBA Book 3 (global) + ley del país del empleador + salario
mínimo del país por fecha + protección de menores + convenio de la
competición como capa de membresía. Estrategias de composición por tipo de
regla (mínimos → el mayor; máximos y duración → el menor; rangos de cuotas
y monedas → intersección; documentos/beneficios/prohibiciones → unión;
cláusulas → tri-estado con `forbidden` ganando; conflictos → `conflicts[]`
explícito que impide crear el contrato). Cada campo conserva traza
`{ruleModuleId, version, value, strategy}`.

### Fuentes, fechas y estado de certeza (consultadas 2026-08-26)

- `fiba-book3-2026-v1` — **verified** — FIBA Internal Regulations Book 3 en
  vigor desde 22-04-2026: duración máxima 4 años, forma escrita. Agentes y
  Letter of Clearance quedan `notImplemented` (MARKET-1/EUROPE-1).
- `es-rd1006-1985-v1` — **verified** — RD 1006/1985 consolidado: forma
  escrita, contenido mínimo, duración determinada, salario en dinero o
  especie, periodo de prueba máximo de 3 meses.
- `es-smi-2026-v1` — **verified** — SMI 2026 (RD 126/2026): 1.221 EUR/mes,
  17.094 EUR/año; la especie no reduce el mínimo monetario; vigencia civil
  acotada a 2026, con continuidad provisional trazada a partir de ahí.
- `es-workers-statute-minors-v1` — **verified** — Estatuto de los
  Trabajadores: edad mínima 16, consentimiento 16-17, sin nocturnidad ni
  horas extraordinarias.
- `acb-abp-cba-2018-22-operational-provisional-v1` — **PROVISIONAL, no
  vigente verificado**: su periodo formal publicado terminó el 30-06-2022.
  Se aplica por continuidad declarada, con warning visible, para el periodo
  de prueba (máx. 1 mes), el mínimo histórico de 28.000 EUR brutos (suelo
  **provisional de simulación**, nunca presentado como dato legal
  actualizado) y las 8-12 mensualidades (10 por defecto). **No se aplica a
  Primera FEB.** El tanteo queda `notImplemented` (MARKET-1).
- `ad-labour-31-2018-v1` — **verified** — Llei 31/2018: forma escrita,
  prueba general de 2 meses como **política evaluable** (los escalones por
  múltiplo salarial quedan `notImplemented`: no se inventa ningún umbral),
  pago al menos mensual, especie limitada, requisitos de menores.
- `ad-smi-2026-07-v1` — **verified** — salario mínimo andorrano desde
  01-07-2026: 1.568,67 EUR/mes (9,05 EUR/hora); el anual se **deriva** de
  12 mensualidades (declarado en `derivedInterpretations`).
- `ad-smi-2026-01-v1` — **provisional** — importe anterior derivado del
  incremento publicado del 2,8%; existe para demostrar que una
  actualización de SMI no es retroactiva.
- `euroleague-spc-2024-reference-v1` y `fr-lnb-ccbp-reference-v1` —
  **reference-only, inactivos**: solo fixtures de arquitectura (el francés
  demuestra la colisión 5 años vs. tope FIBA de 4).

### Caso MoraBanc Andorra

Compite en la ACB (organizada en España) con empleador en Andorra. Resuelve
`employment:AD:acb`: FIBA + Llei 31/2018 + SMI andorrano, **sin RD 1006 ni
SMI español**, con el convenio ACB actuando **solo como capa de membresía**
(forma escrita, documentación, rango de cuotas y base bruta) y un aviso
explícito de que nunca sustituye la ley del país del empleador. Su
calendario de pago resulta de la intersección ACB 8-12 ∩ Andorra 12-12 =
**12 mensualidades**, frente a las 10 de un club español de ACB y las 12
derivadas de la periodicidad legal española en Primera FEB.

### Contrato, registro, dinero y cláusulas

- `src/entities/Contract.js`: entidad independiente de Player/Team, con
  fechas civiles ISO inclusivas, estado DERIVADO (`pending`/`active`/
  `expired`/`terminated`/`void` — "expira pronto" es etiqueta de UI),
  desglose por temporada, calendario de pagos, cláusulas tipadas,
  documentos declarados, protección de menores, `signingContext` congelado
  y `provenance`.
- `src/core/ContractRegistry.js`: `state.contractRegistry` explícito (nunca
  singleton); rechaza ids duplicados y contratos solapados; histórico
  ordenado estable; conserva expirados/terminados/anulados;
  `validateIntegrity()` detecta afiliados sin contrato, contratos de otro
  club y calendarios descuadrados.
- `src/core/ContractService.js`: resuelve contexto y reglas, valida
  (duración, moneda/base, documentos, mínimos por capa, prueba, cuotas,
  cláusulas, menores), crea y registra; expone las proyecciones puras de
  nómina garantizada, variable potencial, beneficios, costes de agente y
  compromisos futuros.
- `src/utils/Money.js` y `src/utils/LocalDate.js`: dinero SIEMPRE entero en
  unidad mínima + ISO 4217 (sin floats de euros, reparto de céntimos exacto
  y determinista, `Intl` solo en presentación) y fechas civiles puras (fin
  de mes y bisiestos correctos, sin desplazamiento por husos).
- Cláusulas tipadas (unión discriminada, todas `modeled-only`):
  player-release, player/club/mutual-option, automatic-renewal,
  relegation-or-nonqualification-out, nba-out, medical-condition y primas
  de equipo/individuales. Un tipo desconocido se rechaza; lo no sustentado
  queda `unspecified` y no se admite. **No existe `hasTanteo`**: el tanteo
  será una máquina de estados en MARKET-1. Un buyout no es un transfer fee.

### Contratos simulados (datos de juego, no reales)

Todos llevan `dataSource: 'simulated-contract-v1'`, `isReal: false`,
`generatorVersion: 'contract-seeder-v1'` y `seedFingerprint`, y la interfaz
muestra siempre: *"Contrato simulado para esta partida; no es un dato
contractual real."* **No se ha escrito nada en `data/real/`.**

El seeder es determinista (hash de `playerId+clubId+seasonKey+
generatorVersion`; **sin `Math.random`**, ids de contrato incluidos) y usa
solo señales visibles (TMB, edad, percentiles de su competición, fuerza del
top-8 del club): nunca Potencial, Ambición, Profesionalidad,
`team.reputation` ni `budget` del dataset.

Calibración (configuración de videojuego, **no** fuentes oficiales ni
presupuestos reales): ACB 1.600.000–18.000.000 EUR y Primera FEB
220.000–1.250.000 EUR de nómina anual garantizada, con
`payrollTarget = low + (high-low) * clubPercentile^2.2`,
`roleWeight = 0.35 + 4.65*qualityIndex^2.4` y factor de edad
(<21: 0.92 · 21-22: 0.96 · 23-30: 1.00 · 31-33: 0.95 · ≥34: 0.85). Se
reserva el mínimo salarial resuelto para todos, se reparte el resto por
peso y se redondea de forma determinista a múltiplos de 1.000 EUR con suma
exacta; si el objetivo no permitiera cumplir el mínimo se ELEVA el objetivo
con warning de calibración (nunca se rebaja el mínimo normativo).

**Puente temporal**: `minimumPlayableRemainingSeasons = 3` — los contratos
bootstrap cubren 3 o 4 temporadas según la fecha de arranque, sin superar
nunca el máximo FIBA de 4 años. Es staging de datos documentado, **no** una
renovación automática ni una distribución contractual real: CYCLE-1 lo
retirará.

### Interfaz

Nueva pantalla **Contratos** (marco laboral aplicable con jurisdicción,
perfil, duración máxima, mínimo aplicado, cuotas y prueba; módulos
normativos con fuentes y fecha de consulta; avisos e inconsistencias;
resumen de nómina/variable/beneficios/agentes; compromisos por temporada;
plantilla contractual; alertas de integridad) y nueva pestaña **Contrato**
en la ficha universal (contrato actual o "Sin contrato", desglose por
temporada, calendario de cuotas, cláusulas, menores, normativa congelada e
histórico). Badges con texto además de color: Simulado, Vigente verificada,
Continuidad provisional, Versión fijada, No ejecutable. **Ningún botón de
renovar, fichar, liberar, ejecutar cláusula, tantear o ceder.**
`team.finances.expenses.playerSalaries` pasa a ser una proyección
refrescada desde el registro (verificado en tests).

### Pruebas ejecutadas (resultados reales)

- `node scripts/test-contract1.js` → **102 OK, 0 FAIL** (7 grupos:
  resolver/bugs heredados, composición, entidad y registro, dinero y pagos,
  contratos y cláusulas, seeder, auditorías estáticas de alcance).
- `node scripts/smoke-contract1.js 3` → **OK**: 36 clubes, 3 temporadas
  completas con Copa, Playoffs y ascensos; 752 jugadores mundiales y 752
  contratos (100% simulados); estados `{active: 752}`; por jurisdicción
  `{ES: 729, AD: 23}`; por perfil `{employment:ES:acb 380,
  employment:AD:acb 14, employment:ES:primera-feb 349,
  employment:AD:primera-feb 9}`; nómina ACB min 502.000 € / media
  6.776.889 € / máx 18.291.000 €; Primera FEB min 418.000 € / media
  1.180.056 € / máx 2.934.000 €; 324 newgens contratados (55 menores con
  marcadores simulados); 3 warnings normativos provisionales; 0 avisos de
  calibración.
- `node scripts/verify-contract1-playwright.js desktop` → **36 OK, TODO
  OK**; `... mobile` → **TODO OK** (1280×900 y 390×844, sobre `file://`).
- Regresión: `test-roster1.js` **31 OK, 0 FAIL**; `smoke-roster1.js` OK;
  `verify-roster1-playwright.js` desktop y mobile **TODO OK**;
  `test-life1/2/3/4.js` **22/28/23/26 OK, 0 FAIL**; `smoke-life1/2/3.js` y
  `smoke-life4.js` (3 temporadas) OK; `verify-life3-playwright.js` sin
  fallos; `verify-life4-playwright.js` desktop y mobile **TODO OK**.
- Comprobación sintáctica (`node --check`) de todos los JS nuevos y
  modificados.

Dos adaptaciones documentadas en scripts existentes, conservando su
objetivo original: `scripts/test-roster1.js` (el dominio `employment` ya no
figura como `notImplemented` porque CONTRACT-1 lo implementa, y
`effectiveSeason` se sustituye por `validity.seasonFrom`) y
`scripts/verify-life4-playwright.js` (se aplica el mismo filtro de errores
de consola por Google Fonts sin red que ROSTER-1 ya usaba; sus 13
comprobaciones funcionales pasaban ya antes).

### Archivos

Nuevos: `src/entities/Contract.js`, `src/core/ContractRegistry.js`,
`src/core/ContractService.js`, `src/core/ContractSeeder.js`,
`src/core/ClubEmploymentContextCatalog.js`, `src/utils/Money.js`,
`src/utils/LocalDate.js`, `scripts/test-contract1.js`,
`scripts/smoke-contract1.js`, `scripts/verify-contract1-playwright.js`.
Modificados: `src/core/CompetitionRules.js`, `src/ui/game.js`,
`src/ui/game.css`, `index.html`, `scripts/test-roster1.js`,
`scripts/verify-roster1-playwright.js`,
`scripts/verify-life4-playwright.js`, `DESIGN.md`, `CLAUDE.md`,
`CHANGELOG.md`.

**`data/real/` no se ha tocado.** Tampoco se ha modificado ningún módulo
protegido (`Bracket.js`, `Cup.js`, `Playoffs.js`, `Promotion.js`,
`League.js`, `Calendar.js`, `Recovery.js`, `SeasonGoals.js`,
`Tactics.js`).

### Fuera de alcance de esta entrega

Negociación jugador/agente, entidad Agent funcional, ofertas y
contraofertas, derecho de tanteo, licencias/cupos/elegibilidad/vinculados,
traspasos, buyout ejecutable, rescisión y compensaciones, cesiones, Letter
of Clearance, ligas extranjeras reales, overlay operativo de EuroLeague, IA
de mercado, renovaciones automáticas, sustituciones por expiración,
retiros/equilibrio poblacional, save/load y migraciones, motor fiscal,
movimientos de caja/impagos/avales, contratos de entrenadores o staff.

**Siguiente entrega: REG-1** (inscripción, licencias, elegibilidad, cupos y
jugadores vinculados).
