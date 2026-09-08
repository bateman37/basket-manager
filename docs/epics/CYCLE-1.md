# Ficha de Epic — CYCLE-1 (ciclo anual de plantilla)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `CYCLE-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Ciclo anual de plantilla: expiración, renovación, retirada, cantera y clearinghouse.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/annual-cycle.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 1955-2118 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-28 — CYCLE-1: ciclo anual de plantilla — expiración, renovación, retirada, cantera y clearinghouse (DESIGN.md 9.22)

Séptima entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → CONTRACT-1 → REG-1 → MARKET-1 → TRANSFER-1 → LOAN-1 →
**CYCLE-1** → EUROPE-1 → HARDEN-1). Base: LOAN-1 (ya fusionada en `main`,
PR #43). Sustituye el cierre de temporada monolítico (ascender/descender
→ resembrar inscripciones a mano → 3 newgens directos a plantilla por
club → sustituir el `Calendar`) por una máquina de estados real de 13
fases con fechas civiles reales, y retira el puente temporal de
CONTRACT-1 (`MINIMUM_PLAYABLE_REMAINING_SEASONS = 3`): los contratos
expiran orgánicamente, se renuevan o generan tanteo real, los jugadores
se retiran de forma individual y determinista (nunca por Potencial
oculto), y la cantera vive como pool separado hasta una promoción real.

### Estabilización previa (red→green antes de construir el ciclo)

BUG-LOAN1-01 (fallback silencioso a selector no regulado cuando el pool
de `CpuLineup` quedaba vacío — ahora `outcome` tipado
`'legal'|'medical-exception'|'infeasible'`, nunca un acta ilegal en
silencio) y BUG-CYCLE1-01..05 (generación de edad/fecha de nacimiento por
reloj de sistema → determinista vía `CareerAge`+semilla; mutación en
render de `renderPlayerProfileScreen()` → render puro, sin
`ensureCareerHistory()` como efecto secundario de abrir una ficha;
ciclo de vida del mundo repartido → `WorldLifecycleService` como único
punto de inicialización real; cierre de temporada monolítico → 13 fases
reales) — verificados con pruebas dirigidas, no solo revisados por
inspección; uno de los cinco (BUG-CYCLE1-03) seguía sin corregir en el
código heredado al empezar esta sesión pese a estar documentado como
resuelto, confirmado con `git diff` contra la base de la entrega.

### El ciclo anual — 13 fases, fechas reales

`CycleConfig.CYCLE_PHASES`: `competitions-complete → snapshot-frozen →
season-history-closed → loans-and-options-reviewed →
rights-and-retention-open → retirements-reviewed →
renewals-and-free-agency → academy-decisions → clearing-rounds →
roster-legality-audit → licenses-and-registrations → preseason-ready →
new-season-started`, cada una con desplazamiento en días civiles desde el
último partido oficial real del mundo (nunca "pasos" abstractos). Ninguna
temporada empieza con un club ilegal: una fase que deja clubes NOT READY
lanza un diagnóstico explícito por club en vez de dejar pasar el año en
silencio (invariante 26).

### Contratos, renovación, opciones y tanteo orgánico

`ContractExpiryService` cierra contratos vencidos orgánicamente.
`RenewalService` negocia renovaciones (un turno por ronda, resultado
tipado `'agreement-in-principle'`/`'rejected'`/`'expired'`/`'blocked'`/
`'countered'`) y decide opciones contractuales
(`ContractOptionDecision`). `AnnualCycleService.openRightsAndRetention()`
cierra el gancho que MARKET-1 dejó explícitamente pendiente: los casos de
tanteo ya se abren orgánicamente sobre contratos que expiran de verdad
(788 casos sobre 1629 expiraciones en la prueba de humo de 10
temporadas).

### Retirada individual y determinista

`RetirementService` decide retirada por jugador usando solo señales
VISIBLES (tendencia de TMB, carga médica, minutos recientes, edad) —
nunca Potencial oculto —, siempre determinista dada una `careerSeed`
explícita. Un retirado sale de la plantilla pero sigue siempre
localizable en el Player Registry.

### Cantera como pool separado

`AcademyService` sustituye la incorporación directa a plantilla (BUG-
CYCLE1-05, retirado): los newgens entran en `AcademyRegistry` (cupo real
hasta 8 por club) y solo una decisión real
(`promoteToFirstTeam()`) los mueve al primer equipo.

### Planificación CPU y clearinghouse

`CpuRosterPlanner` (puro, determinista, orden-independiente — verificado
con huella canónica byte-a-byte barajando clubes/jugadores) construye
planes por club; `runClearingRounds()` los resuelve de forma determinista
para renovación, fichaje de agente libre y promoción de cantera.
**Limitación de alcance documentada, no oculta**: esta entrega no abre
traspasos ni cesiones CPU-a-CPU orgánicos entre clubes — siguen siendo
solo acciones dirigidas por el usuario vía Mercado (TRANSFER-1/LOAN-1).

### Legalidad de plantilla como propiedad viva

Hallazgo real durante la prueba de humo de 10 temporadas: un roster legal
al empezar la temporada puede volverse ilegal a mitad de temporada sin
ningún evento explícito (reclasificación de formación por edad). Antes
de esta corrección, `smoke-cycle1.js` fallaba en la temporada 5 con un
acta ilegal no detectada. Corregido reintentando la misma escalera de
emergencia (`RosterLegalityService.applyEmergencyLadder()`) en el
momento de construir cada convocatoria, compartido por `game.js` y todos
los arneses de prueba vía el nuevo `scripts/cycle1-harness.js`.

### Interfaz — pantalla "Planificación"

Nueva pantalla entre Mercado y Agenda: legalidad de plantilla del club
del usuario con botón real "Delegar medidas de emergencia" (corrige
BUG-CYCLE1-04: `game.js` forzaba el consentimiento a `true` sin pasar por
el usuario — ahora respeta el consentimiento real que el CORE ya exigía
correctamente), contratos que vencen con "Proponer renovación" real,
Academia con "Promocionar" real, y retiradas anunciadas de la propia
plantilla. Cerrar temporada ya no salta directo a la siguiente liga: pasa
por el ciclo real, y si algún club queda NOT READY, la partida se detiene
en esta pantalla con el diagnóstico real.

### Regresión completa de la EPIC

`TransferRegistry.validateIntegrity()` necesitó una excepción ampliada
(`explainedByCurrentContract`) para reconocer las dos vías nuevas y
legítimas de cambio de `player.teamId` sin `TransactionRecord`
(expiración orgánica de contrato, alta de emergencia de plantilla).
Actualizados `scripts/smoke-contract1.js`, `scripts/smoke-reg1.js`,
`scripts/smoke-market1.js`, `scripts/smoke-transfer1.js` y
`scripts/smoke-loan1.js` para consumir el ciclo anual real vía
`scripts/cycle1-harness.js` en vez de su propio cierre de temporada
copiado — cada uno conserva íntegras sus propias comprobaciones de
dominio (REG-1/MARKET-1/TRANSFER-1/CONTRACT-1), solo cambia el mecanismo
de transición de temporada. Todos los `test-*.js` (11 suites, 563
comprobaciones), todos los `smoke-*.js` (7 scripts, 36 equipos cada uno)
y todos los `verify-*-playwright.js` (9 scripts × desktop+mobile) pasan
limpios. `data/real/*` confirmado sin tocar.

### Pruebas y resultados reales

`scripts/test-cycle1.js`: **42 comprobaciones, 0 fallos**.
`scripts/smoke-cycle1.js 10`: 36 equipos reales, **10 temporadas
completas** — 458 → 1538 jugadores mundiales (histórico), 1981 contratos,
1629 expiraciones orgánicas, 172 renovaciones comprometidas, 788 casos de
tanteo abiertos orgánicamente, 116/112 retiradas anunciadas/efectivas,
1080 pertenencias de academia (histórico), 1047 salidas de la vía
profesional, 854 acciones de emergencia de plantilla, 13182 actas de
partido registradas, población ACTIVA final 379 sobre una cota de 1140.
Determinismo verificado con triple ejecución: misma semilla → decisiones
idénticas; clubes/jugadores barajados → decisiones equivalentes; semilla
distinta → decisiones distintas. `scripts/verify-cycle1-playwright.js`
(escritorio y móvil sobre `file://`): **19/19 OK** en ambos modos,
incluyendo el fixture que expuso el bug de consentimiento
(BUG-CYCLE1-04) y el hallazgo de deriva de legalidad a mitad de
temporada.

### Archivos nuevos

`src/entities/Cycle.js`, `src/core/CycleConfig.js`,
`src/core/CycleEventTypes.js`, `src/core/CycleTransaction.js`,
`src/core/AnnualCycleRegistry.js`, `src/core/AnnualCycleService.js`,
`src/core/AcademyRegistry.js`, `src/core/AcademyService.js`,
`src/core/ContractExpiryService.js`, `src/core/RenewalService.js`,
`src/core/RetirementService.js`, `src/core/RosterLegalityService.js`,
`src/core/CpuRosterPlanner.js`, `src/core/MarketClearinghouse.js`,
`src/core/SeasonHistoryService.js`, `src/core/WorldLifecycleService.js`,
`src/utils/CareerAge.js`, `scripts/cycle1-harness.js`,
`scripts/test-cycle1.js`, `scripts/smoke-cycle1.js`,
`scripts/verify-cycle1-playwright.js`. Documentación: DESIGN.md 9.22 (+
cross-referencias actualizadas en 9.16, 3.4, 6.2.3 y las secciones "Fuera
de alcance" de CONTRACT-1/REG-1/MARKET-1/TRANSFER-1/LOAN-1), bloque de
convenciones permanentes en CLAUDE.md.

### Fuera de alcance de CYCLE-1

Transfer internacional real y licencia FIBA para la operación —
**EUROPE-1**; traspasos/cesiones CPU-a-CPU orgánicos fuera del
clearinghouse de agentes libres (ver limitación documentada arriba) — sin
entrega asignada todavía, proponer antes de construir; save/load real y
congelación de reglas por versión de una temporada ya iniciada —
**HARDEN-1**.
