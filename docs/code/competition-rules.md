# Mapa de código — `src/core/CompetitionRules.js`

Mapa de navegación, no una copia del código (3 633 líneas). Es el motor
normativo multi-dominio (registro/empleo/mercado/traspaso/cesión) — la
identidad de competición en sí vive en `src/core/CompetitionCatalog.js`
(fuente canónica; este archivo importa/reexporta los mismos objetos). Ver
`docs/design/roster-registry.md`, `docs/design/contracts.md`,
`docs/design/registration-eligibility.md`, `docs/design/market.md`,
`docs/design/transfers.md`, `docs/design/loans.md`.

```bash
rg -n "^  function resolve\w+Rules" src/core/CompetitionRules.js
```

## Tabla de responsabilidades

| Responsabilidad | Símbolo | Colaboradores | Diseño relacionado |
|---|---|---|---|
| Resolución normativa de inscripción/plantilla (dominio `registration`) | `resolveRules(context)`, `resolveRegistrationDomain()`, `composeSquadRules()` | `RegistrationRegistry`, `EligibilityService` | `docs/design/registration-eligibility.md` |
| Resolución de empleo/contrato (dominio `employment`) | `getEmploymentModule()`, `composeEmployment()`, `evaluateProbationPolicy()` | `ContractRegistry`, `ClubEmploymentContextCatalog.js` | `docs/design/contracts.md` |
| Resolución de mercado (dominio `market`) | `resolveMarketRules(context)`, `resolveMarketDomain()`, `deriveMarketCapabilities()` | `AgentRegistry`, `MarketRegistry` | `docs/design/market.md` |
| Resolución de traspaso (dominio `transfer`) | `resolveTransferRules(context)`, `resolveTransferDomain()`, `selectTransferModuleByJurisdiction()` | `TransferRegistry`, `TransferExecutionService` | `docs/design/transfers.md` |
| Resolución de cesión (dominio `loan`) | `resolveLoanRules(context)`, `resolveLoanDomain()`, `getLoanModule()` | `LoanRegistry`, `LoanExecutionService` | `docs/design/loans.md` |
| Vigencia y selección de módulo por fecha | `buildValidity()`, `coversExactly()`, `selectByValidity()` | cada dominio anterior | todos los documentos de diseño de este dominio |
| Composición de perfiles normativos | `composeSquadRules()`, `composeEmployment()` | nunca `Object.assign()`/spread genérico — cada tipo de regla usa su propia estrategia (mínimos concurrentes, máximos concurrentes, ventanas, state machine) | `docs/architecture/roster-lifecycle-domain.md` |
| Catálogo de competiciones (identidad) | `findBundlesForCompetition()`, `resolveBundleDetailed()`/`resolveBundle()` | `CompetitionCatalog.js` (fuente canónica), `getCompetitionDefinition()` (wrapper de compatibilidad) | `docs/architecture/world-model.md` |

## Invariantes de auditoría

- Ninguna regla se aplica sin fuente oficial + versión/temporada de
  vigencia + estado (`verified`/`provisional`/`deprecated`) — ver
  `trace`/`sourceRefs`/`knownSourceInconsistencies` en cada `resolve*`.
- Ninguna función de este archivo rama por `division` (`'1ª'`/`'2ª'`) ni
  por nombre visible de liga/país — todo por `competitionId`. Un caso sin
  cobertura lanza explícito, nunca hereda ACB por defecto.
- MoraBanc Andorra (organizador ACB, jurisdicción laboral Andorra) es el
  test transfronterizo obligatorio de los cinco dominios — cualquier
  cambio normativo debe seguir resolviéndolo sin fallback español.

## Ejemplos de búsqueda útiles

```bash
rg -n "function resolve\w+Domain" src/core/CompetitionRules.js
rg -n "MoraBanc|AD_NO_LOAN_REGIME_SOURCED" src/core/CompetitionRules.js
rg -n "carryForwardUntilSuperseded" src/core/CompetitionRules.js
```
