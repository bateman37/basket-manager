# Arquitectura — invariantes transversales del ciclo de plantilla

_Migrado de `CLAUDE.md` (líneas 221-261 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

## Ciclo profesional de plantilla (ROSTER-1, CONTRACT-1, REG-1, MARKET-1, TRANSFER-1, LOAN-1, CYCLE-1 y siguientes)

Convenciones permanentes de la EPIC iniciada en ROSTER-1 (DESIGN.md 9.16),
ampliada en CONTRACT-1 (DESIGN.md 9.17), en REG-1 (DESIGN.md 9.18), en
MARKET-1 (DESIGN.md 9.19), en TRANSFER-1 (DESIGN.md 9.20), en LOAN-1
(DESIGN.md 9.21) y en CYCLE-1 (DESIGN.md 9.22) — aplican a toda sesión
futura que toque contratos, licencias, inscripción, elegibilidad, mercado,
traspasos, cesiones, el ciclo anual (expiración, renovación, retirada,
cantera, legalidad de plantilla) o transfer internacional:

- Todo jugador vive en el Player Registry mundial
  (`src/core/PlayerRegistry.js`, `state.playerRegistry`); una plantilla
  (`Team.roster`) solo contiene referencias afiliadas, nunca es el
  directorio global de jugadores.
- Código nuevo nunca busca a un jugador recorriendo los rosters de los
  equipos actuales como si fueran un índice global — se resuelve desde el
  registro.
- Lógica normativa nueva usa `competitionId` (`src/core/
  CompetitionRules.js`) y `RulesetBundle`/`RuleModule` — nunca `division`
  (`1ª`/`2ª`), el nombre visible de una liga, ni un comportamiento ACB
  aplicado por defecto a una competición desconocida.
- La UI consulta CAPACIDADES derivadas (`resolved.capabilities.has(...)`)
  para decidir qué mostrar, pero el CORE siempre valida con la política
  real correspondiente — una capacidad nunca implementa el
  comportamiento por sí sola.
- La relación laboral (contrato) y el registro/licencia por competición
  son conceptos separados — un contrato no concede una licencia, una
  licencia no sustituye a un contrato.
- Toda norma codificada (cupos, convocatoria, altas, ventanas...) incluye
  fuente oficial, versión/temporada de vigencia y estado
  (`verified`/`provisional`/`deprecated`) — nunca un número sin
  procedencia.
- No se mezclan perfiles normativos con `Object.assign()`/spread
  genérico — cada tipo de regla usa la estrategia de composición que le
  corresponde (mínimos concurrentes → el mayor; máximos concurrentes → el
  menor; ventanas → intersección; procedimientos como el tanteo → state
  machine, nunca merge de campos).
- Las reglas de una temporada ya iniciada quedarán congeladas por
  versión (`rulesetBundleId`+`version`) cuando exista persistencia real
  (HARDEN-1) — no se implementa guardado nuevo antes de esa entrega.
