# Ficha de Epic — MARKET-1 (mercado, agentes, negociación)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `MARKET-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Mercado, agentes, negociación, ofertas y derechos preferentes.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/market.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2338-2465 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-26 — MARKET-1: mercado, agentes, negociación y derechos preferentes (DESIGN.md 9.19)

Cuarta entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → CONTRACT-1 → REG-1 → **MARKET-1** → TRANSFER-1 → LOAN-1 →
CYCLE-1 → EUROPE-1 → HARDEN-1). Base: REG-1 (ya fusionada en `main`). Esta
entrega añade la vertical de NEGOCIACIÓN: búsqueda de jugadores en el
Player Registry mundial, representación por agentes (principios FIBA),
hilos de negociación con respuesta de CPU diferida en el reloj real,
ofertas de contrato inmutables/versionadas, reservas presupuestarias
contra un límite interno simulado, y el procedimiento ACB completo de
derecho de tanteo (arts. 13-17) como máquina de estados fechada.

El resultado final de una negociación exitosa es un **Agreement in
Principle**: en esta PR nunca toca `Team.roster`, `ContractRegistry` ni
`RegistrationRegistry` — formalizar el fichaje es de **TRANSFER-1**, la
próxima entrega. Las pantallas Contratos/Inscripciones siguen siendo de
solo lectura.

### Bugs de REG-1/táctico estabilizados antes de construir MARKET-1

- **BUG-REG1-06** — caché/registros de carrera (`registrationClassificationCache`
  y similares) sin declarar en el `state` canónico y sin limpiar al volver
  a selección de equipo, con riesgo de filtrar clasificaciones de la
  carrera anterior. Corregido declarando y centralizando su creación/
  limpieza (incluidos los nuevos `agentRegistry`/`marketRegistry`).
- **BUG-REG1-07** — una inscripción podía referenciar el `contractId` de
  OTRO jugador/club sin que nada lo detectara. Corregido con comprobación
  cruzada jugador/club en `RegistrationService.createRegistration()` y en
  `RegistrationRegistry.validateIntegrity()`.
- **BUG-REG1-08** — la elegibilidad de partido usaba `contract.isCurrentOn()`
  en vez de `contract.isActiveOn()`: un contrato firmado pero todavía
  `pending` acreditaba relación laboral activa hoy. Corregido.
- **BUG-REG1-09** — un código de motivo de doble acta llevaba "ACB" en el
  nombre dentro de un core agnóstico de competición
  (`ALREADY_ON_OTHER_ACB_ACT_SAME_ROUND`). Renombrado a
  `ALREADY_ON_OTHER_ACT_SAME_ROUND`.
- **BUG-PREEXISTING-TAC-01** — una alineación degenerada (un mismo jugador
  titular en dos posiciones) llegaba hasta `Tactics.computeAdvantageScore()`
  y lanzaba un `TypeError` dependiente de los datos. Corregido detectando
  el duplicado en `Rotation.validateLineup()` antes del motor táctico —
  sin cambiar fórmulas, pesos ni resultados de ninguna alineación válida.

Regresión sin fallos tras el fix: `test-reg1.js` (88), `test-contract1.js`
(102), `test-roster1.js` (31), `test-life1..4.js` (22/28/23/26).

### Bugs encontrados y corregidos durante esta entrega

Ninguno de estos dos bugs lo detectaron los tests unitarios/smoke
aislados — ambos solo aparecieron ejercitando el flujo real de firma en
`verify-market1-playwright.js`, motivo por el que la verificación de
interfaz real es obligatoria y no opcional:

- **BUG-MARKET1-01** — una oferta de mercado firmada después del inicio de
  temporada era siempre irrealizable: `buildMarketOfferDraft()` fijaba
  `startDate` en el 1 de julio de la temporada, y `Contract.js` rechaza
  toda firma retroactiva (`signedDate` posterior a `startDate`) — el
  camino "feliz" de fichar un libre a mitad de temporada estaba roto desde
  el primer uso real. Corregido: el contrato arranca en la fecha real de
  firma cuando esta cae después del inicio de temporada, y el calendario
  de pagos de esa primera temporada se acota a los periodos que realmente
  caben hasta su fin (en vez de desbordar la vigencia con el número de
  cuotas por defecto de una temporada completa).
- **BUG-MARKET1-02** — la pestaña "Derechos" quedaba visible/activa tras
  cambiar a un club sin procedimiento doméstico de tanteo (p. ej. ACB →
  Primera FEB), porque la ocultación solo se evaluaba cuando esa pestaña
  NO era ya la activa. Corregido: la pestaña activa se reconduce a
  "Buscar jugadores" en el mismo render si la competición del club actual
  no soporta tanteo.

### Arquitectura

Nuevo dominio `market` en `CompetitionRules.js` (mismo patrón de catálogo/
composición que `registration`/`employment`): principios FIBA universales
(`verified`), procedimiento ACB de tanteo (`provisional`, con warning de
continuidad operativa desde 2026 pese al convenio BOE formalmente vencido
en 2022), overlay EuroLeague `reference-only` y fixture `reference-only`
de competición ficticia — Primera FEB no hereda nada de ACB, una
competición desconocida lanza explícito.

Entidades event-sourced (mismo patrón que REG-1): `src/core/MarketEventTypes.js`
(motor genérico de máquina de estados), `src/entities/Agent.js`
(`Agent`/`RepresentationMandate`), `src/entities/Market.js`
(`NegotiationThread`, `ContractOffer` inmutable, `AgreementInPrinciple`,
`QualifyingOfferCase`, `RightOfFirstRefusalCase`, `ReturnRightsCase`,
`DebtChallenge`, `PotentialCompensationClaim`). Registros explícitos por
carrera: `src/core/AgentRegistry.js`, `src/core/MarketRegistry.js`.
Negociación determinista: `src/utils/DeterministicRandom.js` (PRNG por
hash, cero `Math.random()`), `src/core/NegotiationService.js`
(`evaluateOffer()`, presupuesto simulado con reservas). Procedimiento ACB:
`src/core/RightOfFirstRefusalService.js` (plazos exactos 3+3+3+13+1+5/10
días naturales). Bootstrap: `src/core/MarketSeeder.js` (30 libres
ficticios + agentes/mandatos simulados, determinista, `data/real/`
intacto). `ContractService.validateDraft()` valida un borrador de
contrato con las reglas de CONTRACT-1 sin registrar nada. Reloj: `market`
pasa de reservado a evento activo (`Events.js`); `advanceGameClockTo()`
(único punto que avanza `state.calendar`) se detiene ante una
contraoferta viva o una decisión de tanteo pendiente. UI: pantalla
Mercado de 5 pestañas (Buscar jugadores/Seguimiento/Negociaciones/
Agentes/Derechos) + pestaña "Mercado y representación" en la ficha
universal.

### Pruebas y resultados reales

`scripts/test-market1.js`: **82 comprobaciones, 0 fallos** (9 grupos,
incluida la auditoría estática de alcance de la sección 20 del prompt).
`scripts/smoke-market1.js 3`: 36 clubes reales, 3 temporadas completas con
Liga+Copa+Playoffs+Ascenso+cantera+mercado — 782 jugadores mundiales (30
libres ficticios), 752 contratos, 5 agentes/19 mandatos, 1 Agreement in
Principle, 4 casos de tanteo + 1 de retorno (fixtures dirigidos,
determinismo verificado con la misma semilla), 52 eventos de mercado,
105.4s. `scripts/verify-market1-playwright.js` (escritorio y móvil):
**TODO OK** en ambos modos. Regresión sin fallos: `test-roster1.js` (31),
`test-contract1.js` (102), `test-reg1.js` (88), `test-life1..4.js`
(22/28/23/26), `smoke-roster1.js 3`, `smoke-contract1.js 3`,
`smoke-reg1.js 3`.

### Fuera de alcance

Ejecutar el fichaje (mover `player.teamId`, registrar contrato, inscribir)
— TRANSFER-1; traspasos con tercero, buyouts, rescisión, pago de
compensación por renuncia — TRANSFER-1; cesiones — LOAN-1; transfer
internacional real — EUROPE-1; apertura ORGÁNICA de casos de tanteo en
cierre de temporada (bloqueada hoy por el suelo de 3 temporadas restantes
que garantiza CONTRACT-1 en todo contrato — ningún contrato expira aún
dentro de un horizonte verificable) y renovaciones/retiros — CYCLE-1;
save/load. Siguiente entrega: **TRANSFER-1** (traspasos, buyouts,
rescisión y compensaciones).
