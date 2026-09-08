# Mapa de código — `src/ui/game.js`

Mapa de navegación, no una copia del código (10 014 líneas). Usa `rg` para
localizar el símbolo exacto antes de editar; los nombres de función son
buscables y estables, las líneas no lo son. Diseño relacionado:
`docs/design/game-ui-decisions.md` y el documento temático de cada
funcionalidad (tabla en `DESIGN.md`).

```bash
rg -n "function startCareerFromSetup" src/ui/game.js
```

## Tabla de responsabilidades

| Responsabilidad | Símbolo | Colaboradores | Diseño relacionado |
|---|---|---|---|
| Inicio de carrera y construcción del mundo | `startCareerFromSetup(snapshot)` | `CareerSetupService`, `GameWorld`, `WorldRegistries`, `bootstrapContractsForNewCareer()`, `bootstrapRegistrationsForNewCareer()`, `bootstrapMarketForNewCareer()` | `docs/architecture/career-setup-and-navigation.md`, `docs/architecture/world-model.md` |
| Avance del calendario / "Continuar" | `buildWorldCalendarCoordinator()` → `state.calendarCoordinator` | `BM.WorldCalendarCoordinator.advanceUntilNextUserStop()` | `docs/architecture/world-calendar.md` |
| Partido de liga del usuario (motor pausable, modo `'live'`) | `startLiveMatch()`, `advanceLiveMatch()` | `BM.createMatchState`, `BM.advanceMatch`, `GamePlan` | `docs/design/match-simulation.md`, `docs/design/tactics/live-game.md` |
| Partidos de Copa/Playoff/Ascenso (modo `'replay'`, reveal por cuartos) | `startReplayMatchReveal(match)` | `BM.simulateMatch`, `match.result.quarterScores` | `docs/design/game-ui-decisions.md` (revelado por cuartos, matizado) |
| Cierre de temporada | `closeSeasonAndPrepareNext()` | `AnnualCycleService.runPhase()`, `CycleConfig.CYCLE_PHASES`, `SeasonHistoryService` | `docs/design/annual-cycle.md`, `docs/epics/CYCLE-1.md` |
| Ficha del jugador | `renderPlayerProfileScreen()`, `findPlayerById(playerId)` | `state.playerRegistry`, `PlayerCareer.js`, `PlayerDevelopment.js`, `Tactics.js`, `Medical.js`, `Training.js` | `docs/design/career-history.md`, `docs/design/player-development.md` |
| Pantalla Contratos (solo lectura) | `renderContractsScreen()` | `state.contractRegistry`, `ContractService.refreshTeamSalaryProjection()` | `docs/design/contracts.md` |
| Pantalla Inscripciones (solo lectura) | `renderRegistrationsScreen()` | `state.registrationRegistry`, `EligibilityService` | `docs/design/registration-eligibility.md` |
| Pantalla Mercado — negociación | `renderMarketScreen()` | `state.agentRegistry`, `state.marketRegistry`, `ContractService.validateDraft()` | `docs/design/market.md` |
| Pantalla Mercado — Cesiones | `renderMarketLoansTab(team)` | `LoanService`, `LoanExecutionService`, `state.loanRegistry` | `docs/design/loans.md` |
| Planificación táctica y familiaridad | (ver `docs/code/tactics.md`) | `BM.Tactics`, `GamePlan`, `TacticalProfile` | `docs/design/tactics/` |
| Convocatoria y elegibilidad de partido | `getConvocatedPlayers`, `buildEligiblePoolForMatch` | `EligibilityService`, `SquadEligibilityService.selectLegalSquad` | `docs/design/registration-eligibility.md` |
| Guardar/cargar/sobrescribir/eliminar partida (pantalla "Partida" + landing) | `renderSaveLoadScreen()`, `saveCareerToSlot()`, `loadCareerFromSlot()`, `autoSaveCareer()` | `BM.CareerPersistenceBoundary`, `BM.CareerHydrationService`, `BM.IndexedDbCareerSaveRepository` | `docs/architecture/persistence-boundary.md` |

## Patrones estructurales que cualquier cambio debe respetar

- **Selección de equipo**: solo datos reales del bundle
  (`data/real/real-data-bundle.js`), reconstruidos siempre como
  instancias reales de `Player`/`Team` — nunca objetos planos. Ver
  `docs/design/game-ui-decisions.md`.
- **Modelo de alineación**: tabla de slots (5 posiciones × 3 columnas),
  cada slot independiente (`lineup.entries` en `src/core/Rotation.js`) —
  no volver al modelo de "una entrada por jugador".
- **Ningún registro se recrea perezosamente desde un render**: todos
  (`playerRegistry`, `contractRegistry`, `registrationRegistry`,
  `agentRegistry`, `marketRegistry`, `transferRegistry`, `loanRegistry`,
  `annualCycleRegistry`, `academyRegistry`) se construyen en
  `startCareerFromSetup()`/`startSeason()` o en el cierre de temporada.
- **La UI nunca escribe directamente** en `TransferRegistry`/
  `ContractRegistry`/`RegistrationRegistry`/`Team.roster`/
  `player.teamId` — siempre a través del `*Service`/`*ExecutionService`
  correspondiente.
- **`resetCareerState()`** (SAVE-LOAD-1) es el ÚNICO punto que limpia
  `state.*` de una carrera anterior — lo usan tanto "Volver a selección
  de equipo" como `loadCareerFromSlot()` antes de sustituir por la
  carrera hidratada. Ninguna carga/reinicio nuevo debe reimplementar este
  reseteo a mano.

## Ejemplos de búsqueda útiles

```bash
rg -n "function render\w+Screen" src/ui/game.js       # todas las pantallas
rg -n "state\.\w+Registry\b" src/ui/game.js            # puntos de acceso a registros
rg -n "BM\.\w+Service\." src/ui/game.js                # llamadas a servicios de dominio
```
