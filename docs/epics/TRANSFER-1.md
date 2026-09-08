# Ficha de Epic — TRANSFER-1 (traspasos y fichajes)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `TRANSFER-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Traspasos, fichajes, cláusulas de rescisión y compensaciones.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/transfers.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2233-2337 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-27 — TRANSFER-1: traspasos, fichajes, cláusulas y compensaciones (DESIGN.md 9.20)

Quinta entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → CONTRACT-1 → REG-1 → MARKET-1 → **TRANSFER-1** → LOAN-1 →
CYCLE-1 → EUROPE-1 → HARDEN-1). Base: MARKET-1 (ya fusionada en `main`).
MARKET-1 negocia y produce un Agreement in Principle pero se detiene
ahí; esta entrega es el motor que EJECUTA la operación de forma
**atómica** (planifica → revalida → compromete, con rollback exacto ante
cualquier fallo) para los mecanismos domésticos: fichaje de agente
libre, fichaje futuro tras expiración, traspaso definitivo negociado
(dos patas + consentimiento), ejercicio de cláusula de rescisión, mutuo
acuerdo/liberación, terminación por causa del empleador, extinción
unilateral del jugador y causa controvertida verificada.

### Base MARKET-1 estabilizada antes de construir TRANSFER-1

- **BUG-MARKET1-03..07** — `createAndSendOffer` no validaba siempre
  internamente contra el mínimo legal/convenio real; el mandato de agente
  se resolvía mal en algunos casos; una reserva presupuestaria podía
  quedar fugada tras ciertos flujos; el `executionState` de un AIP era una
  constante fija en vez de derivarse de su ciclo de vida real; la regla de
  bloqueo de "Continuar" ante una atención de mercado usaba comparación
  exclusiva en vez de inclusiva. Corregidos con reproducción + regresión
  completa (`test-market1.js` 82 comprobaciones, `smoke-market1.js`,
  `verify-market1-playwright.js`) antes de tocar código nuevo de
  traspasos.

### Motor legal multi-jurisdicción

`CompetitionRules.js` (dominio nuevo `transfer`): España RD 1006/1985 art.
13.a (15 % mínimo sin pacto, nunca sobre un buyout), Andorra Llei 31/2018
(MoraBanc Andorra nunca hereda el 15 % español), ACB Convenio arts.
16/17.4.5/18 (compensación por renuncia de derechos por tramos de edad —
el jugador nunca participa, invariante 13; restricción de inscripción tras
el 15 de septiembre para cláusulas ejercidas), Primera FEB arts.
20.2.b/21/24-27/33-35/36/37, ACB Normas Internas de administración
(módulo `transferAdmin` separado del laboral). Dos módulos
`reference-only` demuestran extensibilidad sin autoseleccionarse nunca.

### Entidades, registro y motor de ejecución atómico

`src/entities/Transfer.js`/`src/core/TransferRegistry.js` (nuevos):
`TransferCase` (expediente con máquina de estados por eventos),
`ClubTransferOffer`, `TransferAgreement`, `ReleaseClauseExercise`,
`ContractTerminationRecord`, `FinancialObligation` (fee, participación,
buyout, settlement, compensación de terminación, compensación ACB y
comisión de agente — SEPARADOS, nunca colapsados), `TransactionRecord`.
`src/core/TransferExecutionService.js` (nuevo): `planTransaction()`
(puro) + `commitTransaction()` (revalida fingerprints, saga con undo
almacenado por paso, rollback exacto verificado con inyección de fallos
en cada punto — contrato, roster, inscripción, licencia — y mundo
EXACTAMENTE igual tras cualquier fallo). `src/core/
RosterMutationService.js` (nuevo): única frontera de `Team.roster`/
`player.teamId` para este dominio. `src/core/TransferService.js`
(nuevo): fachadas por mecanismo, evaluación DETERMINISTA del club
vendedor CPU (nunca `Math.random()`), ciclo de vida real del expediente.
Fichaje futuro tras expiración: un AIP con `effectiveDate` posterior a
hoy deja el expediente `scheduled` (visible ya hoy, nunca en el futuro);
`advanceGameClockTo()` (punto único del reloj) reintenta cada expediente
`scheduled` que ya alcanzó su fecha, replanificando y revalidando
siempre desde cero.

### Interfaz

Mercado > Negociaciones: un AIP vivo muestra el asistente de
formalización real (mecanismo derivado + acción), sustituyendo el texto
estático anterior. Mercado > Operaciones (pestaña nueva, solo lectura):
expedientes del club por estado. Ficha universal, pestaña "Mercado y
representación": expediente activo y traspasos/liberaciones históricos.
Contratos e Inscripciones siguen sin botones de acción.

### Bugs propios de TRANSFER-1, encontrados por smoke/verify (motor
### atómico, no por la suite unitaria de fixtures aisladas)

`ContractRegistry.isClosedBefore()` con comparación estricta bloqueaba el
propio caso de uso central (terminar origen + registrar nuevo el mismo
día); `registerUndo()` ejecutaba la reversión de inmediato en vez de
almacenarla; `pinnedModuleIds` cruzaba dominios `transfer`/`employment`;
el consentimiento del jugador se deducía en vez de exigirse explícito;
`TransactionRecord` exigía `destinationClubId` siempre, rompiendo una
liberación pura; `evaluateSellingClub()` pasaba una fecha ISO donde se
esperaba una clave de temporada; un contrato nuevo de traspaso podía
quedar con `startDate` retrocedida al inicio de temporada, solapando con
el de origen; la inscripción de destino colisionaba con la de origen
cuando compartían competición/temporada (id determinista sin
transacción); `originRegistrationScopeId`/`originSeasonKey` eran
opcionales que ningún llamador real pasaba nunca; `formalizeNegotiatedTransfer`
no registraba el `ClubTransferOffer` real; `retryScheduledTransferCase()`
podía reintentar un expediente ya completado ante fechas de ronda fuera
de orden entre 1ª/2ª; un importe de contraoferta sugerido en la UI no
respetaba el `step` del campo, bloqueando el siguiente envío en silencio.

### Verificación

`scripts/test-transfer1.js` (54 comprobaciones: dominio legal multi-liga,
cálculo monetario España/Andorra/ACB, los 4 mecanismos principales
atómicos, fallos inyectados con rollback exacto, idempotencia,
auditorías estáticas de alcance, fichaje futuro programado).
`scripts/smoke-transfer1.js` (36 equipos reales, 3 temporadas completas
con Liga+Copa+Playoffs+Ascenso+cantera+mercado+traspasos, 5 fixtures
dirigidos). `scripts/verify-transfer1-playwright.js` (desktop+mobile,
Mercado > Operaciones, asistente de formalización, ficha universal).
Regresión completa de la EPIC (ROSTER-1/CONTRACT-1/REG-1/MARKET-1/LIFE-1..4)
en verde. `data/real/` intacto.
