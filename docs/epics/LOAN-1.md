# Ficha de Epic — LOAN-1 (cesiones, retorno, recall)

> **Cabecera de ficha — histórica.** Este documento describe lo que ocurrió
> en su momento (objetivo, decisiones, pruebas ejecutadas, deuda dejada) —
> no establece el estado actual del proyecto. Para el estado vigente ver
> `docs/STATUS.md` y el documento canónico de diseño/arquitectura
> enlazado abajo. Para Epics anteriores a esta migración no se reconstruye
> retroactivamente una lista formal de "archivos permitidos": los archivos
> afectados que se pueden acreditar son los que aparecen en las secciones
> "Archivos nuevos/modificados/principales" del propio contenido migrado
> más abajo.

- **Identificador**: `LOAN-1`
- **Estado**: cerrada (histórica)
- **Objetivo**: Cesiones domésticas, retorno, recall y opción de compra.
- **Documento(s) canónico(s) vigente(s)**: `docs/design/loans.md`
- **Contenido de esta ficha**: migrado tal cual de `DESIGN.md`/`CHANGELOG.md`
  (commit base `83b85d1`) — ver `docs/reference/LEGACY_MAP.md`.

---

_Migrado de `CHANGELOG.md` (líneas 2119-2232 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## 2026-08-27 — LOAN-1: cesiones, retorno, recall y opción de compra (DESIGN.md 9.21)

Sexta entrega de la EPIC "Ciclo profesional de plantilla" (9 partes:
ROSTER-1 → CONTRACT-1 → REG-1 → MARKET-1 → TRANSFER-1 → **LOAN-1** →
CYCLE-1 → EUROPE-1 → HARDEN-1). Base: TRANSFER-1 (ya fusionada en
`main`, PR #42). Una cesión NO es un traspaso corto: el contrato matriz
nunca se mueve, el club propietario sigue siendo el empleador real
durante toda la cesión — solo la afiliación de plantilla y la
licencia/inscripción pasan temporalmente al cesionario. Mecanismos
cubiertos: activación, retorno programado (vía el reloj único), recall
pactado con ventana, terminación anticipada, prohibición de jugar contra
el propietario, y opción de compra con handoff real a TRANSFER-1.

### Regresión de TRANSFER-1 reproducida y corregida antes de construir LOAN-1

BUG-TRANSFER1-13..19 (`ContractRegistry.isClosedBefore()` con comparación
estricta, `registerUndo()` ejecutando la reversión de inmediato en dos
sitios, fuga de `pinnedModuleIds` entre dominios, consentimiento del
jugador deducible, `TransactionRecord` con `destinationClubId`
obligatorio incluso en liberación pura, fecha ISO donde se esperaba una
clave de temporada, y una cadena histórica de traspasos que no
reconocía una cesión activa como explicación legítima de una
discordancia `player.teamId`) — las 7 con test rojo→verde antes de
tocar código nuevo, verificadas en `test-transfer1.js` (67
comprobaciones).

### Motor legal multi-jurisdicción

`CompetitionRules.js` (dominio nuevo `loan`): España RD 1006/1985 art.
11 (cesión temporal, participación del jugador 15 % exacta sobre el
canon cuando lo hay), bloqueo explícito para Andorra
(`AD_NO_LOAN_REGIME_SOURCED` — MoraBanc Andorra nunca hereda el régimen
español ni ACB por defecto, test transfronterizo obligatorio de la
EPIC), módulo ficticio de test para demostrar extensibilidad. ACB/
Primera FEB reutilizan los módulos administrativos/de membresía ya
existentes de TRANSFER-1.

### Entidades, registro y motor de ejecución atómico

`src/entities/Loan.js`/`src/core/LoanRegistry.js` (nuevos): `LoanCase`
(máquina de estados por eventos), `LoanProposal` (inmutable/versionada),
`LoanPartyConsent`, `LoanAgreement` (estado siempre DERIVADO de sus
transacciones reales, modelo de fechas semiabierto
`serviceStartDate <= d < returnEffectiveDate`), `PurchaseOptionExercise`,
y una unión discriminada de cláusulas (recall, opción/obligación de
compra, terminación anticipada, prohibición contra el propietario, rol
prometido, participación mínima, responsabilidad médica/seguro, bonus).
`src/core/LoanExecutionService.js` (nuevo) reutiliza el MISMO patrón
`planTransaction()`/`commitTransaction()` de TRANSFER-1 (replan-at-commit,
undo almacenado por paso, rollback exacto) para activación/retorno/
terminación anticipada. Opción de compra ejercida por el propio
cesionario: como la instancia real vive en su roster, el handoff se
compone de dos pasos atómicos encadenados
(`LoanService.returnLoan()` + el traspaso definitivo normal de
TRANSFER-1) — nunca un tercer motor nuevo. `src/utils/CanonicalHash.js`
(nuevo) extrae la serialización canónica que antes vivía duplicada
dentro de `TransferExecutionService.js`.

### Contrato, inscripción y elegibilidad durante la cesión

`CompetitionRegistration.employmentBasis` (nuevo campo tipado) es el
único mecanismo que explica que el contrato de una inscripción
pertenezca al club EMPLEADOR mientras la inscripción es del club de
SERVICIO — validado en `RegistrationService.createRegistration()`,
`RegistrationRegistry.validateIntegrity()` y
`ContractRegistry.validateIntegrity()` (vía
`loanRegistry.activeAgreementForPlayer()`). `EligibilityService` gana la
cláusula `parent-club-match-eligibility`
(`PARENT_CLUB_MATCH_RESTRICTED`) — mismo servicio único para usuario y
CPU.

### Interfaz

Mercado gana la pestaña **Cesiones**: formulario "Ceder un jugador
propio" que negocia y activa en un único envío. Contratos gana el badge
"Cedido fuera" y una tarjeta de cesiones entrantes — ambos de solo
lectura. Contratos e Inscripciones siguen sin botones de acción.

### Bugs propios de LOAN-1, encontrados por smoke/verify

`evaluatePlayerReaction` ramificaba por `division === '1ª'` (viola la
convención del proyecto); reenviar el mismo formulario de negociación
tras un rechazo colisionaba de id de `LoanCase` (sin discriminador de
intento); **BUG-TRANSFER1-20** — la licencia de destino en
`TransferExecutionService.js` usaba el id determinista por defecto en
vez de uno explícito por transacción (igual fallo ya corregido para la
inscripción pero nunca replicado a la licencia), destapado por el
fixture de opción de compra de LOAN-1 (cedido→devuelto→comprado en
firme por el mismo excesionario, misma temporada); la re-inscripción de
retorno de una cesión nunca referenciaba el contrato matriz
(`contractId: null` fijo); `RegistrationRegistry.validateIntegrity()` no
conocía `employmentBasis`, así que cualquier cesión real rompía la
comprobación de integridad de BUG-REG1-07; `scripts/smoke-transfer1.js`
llevaba roto desde BUG-TRANSFER1-16 (nunca pasaba `operationalContext`)
y nunca se había vuelto a ejecutar completo desde esa entrega —
corregido como parte de esta regresión.

### Verificación

`scripts/test-loan1.js` (52 comprobaciones: reglas/entidades-registro/
fechas/contrato-inscripción/dinero/cláusulas/ejecución atómica/
auditorías estáticas). `scripts/smoke-loan1.js` (36 equipos reales, 3
temporadas completas: 782 jugadores mundiales, 753 contratos, 8
acuerdos de cesión — 6 devueltos, 1 convertido a traspaso definitivo, 1
vigente; 5 retornos procesados automáticamente vía el reloj único; 11
fixtures dirigidos: canon+15 %, cruce de competiciones, recall válido/
bloqueado, Medical durante cesión, prohibición contra el propietario,
opción de compra + handoff, bloqueo MoraBanc, rollback ante fallo
inyectado, determinismo CPU). `scripts/verify-loan1-playwright.js` (18
comprobaciones × desktop+mobile). Regresión completa de la EPIC
(ROSTER-1/CONTRACT-1/REG-1/MARKET-1/TRANSFER-1/LIFE-1..4) en verde,
incluyendo `smoke-transfer1.js` (3 temporadas) ejecutado de extremo a
extremo por primera vez desde BUG-TRANSFER1-16. `data/real/` intacto.
