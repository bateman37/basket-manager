# Contratos profesionales (CONTRACT-1)

_Migrado de `DESIGN.md` (líneas 5549-5941 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### 9.17 CONTRACT-1 — Contrato profesional, vigencia, salario y cláusulas

Segunda entrega de la **EPIC "Ciclo profesional de plantilla"** (ver el
roadmap de nueve partes en 9.16). ROSTER-1 dio identidad mundial al jugador
y un núcleo normativo multi-liga; **CONTRACT-1 crea la relación LABORAL
canónica entre club y jugador**: vigencia, remuneración, calendario de
pagos, garantía, periodo de prueba, cláusulas tipadas, registro contractual
y jurisdicción del empleador, todo con trazabilidad normativa. El puente
temporal `MINIMUM_PLAYABLE_REMAINING_SEASONS = 3` descrito más abajo en
esta sección quedó **retirado por CYCLE-1** (9.22): los contratos expiran
orgánicamente desde esa entrega.

Estado del roadmap: **ROSTER-1 — hecha**, **CONTRACT-1 — hecha**, **REG-1 —
hecha** (ver 9.18), **MARKET-1 — hecha** (ver 9.19), **TRANSFER-1 — hecha**
(ver 9.20), **LOAN-1 — hecha** (ver 9.21), **CYCLE-1 — hecha** (ver 9.22),
EUROPE-1 → HARDEN-1 pendientes, con las mismas dependencias de 9.16.

#### Objetivo y límites

En esta entrega los contratos se **crean, validan, consultan, proyectan y
visualizan**; todavía **no se firman, renuevan, rescinden ni ejecutan desde
botones de usuario**. No hay negociación, agentes, tanteo, licencias,
traspasos, cesiones, mercado CPU ni save/load (ver "Fuera de alcance").

La regla de dominio permanente sigue siendo:

~~~text
identidad del jugador != afiliación al club != contrato laboral
                       != licencia/inscripción != elegibilidad de partido
                       != autorización internacional de transferencia
~~~

Un jugador puede existir sin club y sin contrato. Un contrato **nunca**
concede una licencia, y una licencia no sustituye al contrato. Jugar una
competición europea no cambia por sí mismo la jurisdicción laboral del
empleador.

#### Bugs corregidos de ROSTER-1

- **BUG-ROSTER1-01 — el resolver temporal ignoraba la temporada
  solicitada.** `resolveBundle()` devolvía `requestedSeasonKey` pero, sin
  `bundleId`, elegía simplemente el bundle de **versión más alta**: una
  norma con vigencia 2030-31 se aplicaba a 2026-27 sin aviso. Ahora cada
  `RuleModule`/`RulesetBundle` declara `validity`
  (`seasonFrom`/`seasonTo`/`dateFrom`/`dateTo` +
  `carryForwardUntilSuperseded`) y la selección es **por la temporada y/o
  fecha solicitada**. Sin coincidencia exacta no hay fallback silencioso:
  solo continúa un módulo que declare `carryForwardUntilSuperseded` **en
  datos**, y lo hace con `resolutionMode: 'provisionalCarryForward'`,
  warning y traza de la versión realmente aplicada. Una norma de vigencia
  futura nunca actúa retroactivamente; una `deprecated` puede resolver un
  compromiso histórico **fijado** (`pinnedModuleIds`) pero jamás se
  autoselecciona ni sirve para una firma nueva; una temporada/fecha sin
  cobertura produce error descriptivo, nunca ACB por defecto.
- **BUG-ROSTER1-02 — la jurisdicción laboral colgaba de la competición.**
  El bundle ACB declaraba `jurisdictionId: 'es-professional-sport'` para
  sus 18 clubes, pero **MoraBanc Andorra compite en la ACB con el empleador
  domiciliado en Andorra**. Se separan los dos ejes:
  `CompetitionDefinition.country` pasa a llamarse **`organizerCountry`**
  (describe al organizador y **no** debe usarse como jurisdicción laboral),
  el bundle de competición deja de declarar jurisdicción y aporta como
  mucho un **overlay de convenio/membresía**
  (`modules.employmentMembershipOverlay`), y la jurisdicción del empleador
  vive en `src/core/ClubEmploymentContextCatalog.js`, con
  `employerJurisdictionId` **explícito para los 36 clubes** (35 ES + 1 AD).
  Un club desconocido no hereda España, ACB ni ningún perfil.
- **BUG-ROSTER1-03 — verificación Playwright intermitente.**
  `verify-roster1-playwright.js` pulsaba el primer nombre de la Alineación,
  que según el orden por posición podía ser un jugador de relleno ficticio
  (histórico `complete`) y no mostraba el texto que BUG-LIFE4-01 quería
  comprobar. Ahora elige explícitamente un jugador REAL.
- **Corrección documental**: los comentarios de ROSTER-1 que situaban
  "jugadores vinculados" en CONTRACT-1 se corrigen — la vinculación es de
  **REG-1** (y de LOAN-1 cuando exista una relación laboral temporal).

#### Arquitectura normativa multi-dominio (un solo motor)

`CompetitionRules.resolveRules(context)` sigue siendo el **punto de entrada
único**; `resolveEmploymentRules(context)` es solo un wrapper fino que
construye contexto y delega. No hay un segundo motor de política que pueda
divergir.

| Dominio | Se resuelve por |
|---|---|
| `registration` (ROSTER-1) | `competitionId` + `seasonKey`/`date` + `operation` + bundle fijado opcional |
| `employment` (CONTRACT-1) | `clubId`, `employerJurisdictionId`, `domesticCompetitionId`, `federationId`, `employmentProfileId`, `seasonKey`, `date`, `operation`, módulos fijados opcionales |

El empleo **nunca** se resuelve por "la competición del próximo partido":
un club puede jugar dos competiciones el mismo mes y seguir teniendo un
único empleador.

**Capas laborales activas** (`layer` de cada `RuleModule`):

| Perfil de club | Capas resueltas |
|---|---|
| Club español en ACB | FIBA Book 3 2026 + España RD 1006/1985 + España SMI por fecha + Estatuto de los Trabajadores (menores) + convenio ACB/ABP histórico-operacional **provisional** |
| Club español en Primera FEB | FIBA Book 3 2026 + España RD 1006/1985 + España SMI por fecha + Estatuto de los Trabajadores (menores) |
| MoraBanc Andorra en ACB | FIBA Book 3 2026 + Andorra Llei 31/2018 + Andorra SMI por fecha + capa ACB/ABP **solo de membresía** de la competición |

Garantías verificadas en tests: Primera FEB **nunca** recibe el mínimo de
28.000 EUR del convenio ACB ni sus diez mensualidades; MoraBanc **nunca**
recibe el RD 1006 ni el SMI español; la capa ACB no convierte
`organizerCountry: ES` en jurisdicción española; EuroLeague y Francia
permanecen **inactivas** (`reference-only`, solo fixtures); un perfil de
otro país (`XX`, solo test) resuelve reglas distintas sin tocar
`Contract`, `Team`, `Player` ni `game.js`.

`employmentProfileId` se **deriva** por composición declarativa
(`employment:<jurisdicción>:<competición doméstica>`), nunca con un `if` de
ACB/FEB/Andorra en `ContractService`. Al ascender o descender,
`domesticCompetitionId` se actualiza en el ÚNICO adaptador de frontera
(`competitionIdFromLegacyDivision`); **un contrato ya firmado conserva
congelados sus módulos y su traza** (`signingContext`), y solo una firma
nueva usa el contexto nuevo.

#### Estrategias de composición (nunca `Object.assign`)

| Tipo de regla | Estrategia |
|---|---|
| Mínimos monetarios concurrentes | máximo exigible (y se conservan TODOS los mínimos, cada uno con sus componentes computables) |
| Duración máxima | mínimo de los topes aplicables |
| Periodo de prueba máximo | mínimo de los topes, admitiendo políticas dinámicas evaluables |
| Rango de número de cuotas | intersección (vacía = conflicto explícito) |
| Periodicidad de pago | la más protectora compatible |
| Monedas / bases admitidas | intersección |
| Campos y documentos obligatorios | unión sin duplicar |
| Beneficios obligatorios / prohibiciones | unión sin duplicar |
| Cláusulas | tri-estado `allowed`/`forbidden`/`unspecified`; `forbidden` gana, y lo no indicado **no** se permite |
| Componentes que cuentan como salario | clasificación **por capa**, nunca un booleano global |
| Reglas incompatibles | `conflicts[]` explícito; `ContractService` se niega a crear el contrato |

Cada campo resuelto explica su procedencia: `trace.fields[campo] = [{
ruleModuleId, version, value, strategy }]`. El resultado incluye además
`profileId`, `requestedContext`, `resolutionMode`, IDs y versiones de
módulos, `sourceRefs`, `warnings`, `knownSourceInconsistencies`,
`capabilities` derivadas y `notImplemented` explícito.

#### Fuentes normativas y estado de certeza

Cada `RuleModule` declara id estable, versión, dominio, ámbito, vigencia,
`status`, `sourceRefs` (título, URL, `retrievedAt`, artículos usados),
`knownSourceInconsistencies`, `notImplemented` y, cuando procede,
`derivedInterpretations` (lo que es LECTURA del proyecto y no texto
literal). No se copian fragmentos legales al código.

| Módulo | Estado | Fuente (consultada 2026-08-26) | Uso activo |
|---|---|---|---|
| `fiba-book3-2026-v1` | verified | FIBA Internal Regulations, Book 3, en vigor desde 22-04-2026 — <https://assets.fiba.basketball/image/upload/documents-corporate-fiba-regulations-internal-regulations-book-3.pdf> | duración máxima 4 años, forma escrita |
| `es-rd1006-1985-v1` | verified | RD 1006/1985, texto consolidado — <https://www.boe.es/buscar/pdf/1985/BOE-A-1985-12313-consolidado.pdf> | forma escrita y contenido mínimo, duración determinada, salario en dinero o especie, prueba máx. 3 meses |
| `es-smi-2026-v1` | verified | SMI 2026 — <https://www.boe.es/eli/es/rd/2026/02/18/126> | 1.221 EUR/mes y 17.094 EUR/año; la especie no reduce el mínimo monetario; vigencia civil 2026 |
| `es-workers-statute-minors-v1` | verified | Estatuto de los Trabajadores — <https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430> | edad mínima 16, consentimiento 16-17, sin nocturnidad ni horas extra |
| `acb-abp-cba-2018-22-operational-provisional-v1` | **provisional** | IV Convenio ACB–ABP (BOE-A-2021-4226) + evidencia operativa del tanteo en <https://www.acb.com/es/liga/noticias/jugadores-sujetos-al-derecho-de-tanteo-145528> | prueba máx. 1 mes, mínimo histórico 28.000 EUR brutos, 8-12 mensualidades (10 por defecto), coberturas |
| `ad-labour-31-2018-v1` | verified | Llei 31/2018 de relacions laborals — <https://www.portaljuridicandorra.ad/L2018031_11> | forma escrita, prueba general 2 meses (política evaluable), pago al menos mensual, especie limitada, menores |
| `ad-smi-2026-07-v1` | verified | Increment del salari mínim des de 01-07-2026 — <https://www.govern.ad/ca/w/el-govern-aprova-un-increment-extraordinari-del-salari-minim-del-2-8-fins-als-1-568-67-euros-mensuals> | 1.568,67 EUR/mes (9,05 EUR/hora), mínimo anual derivado |
| `ad-smi-2026-01-v1` | provisional | importe anterior **derivado** del incremento publicado del 2,8% | demuestra que una actualización de SMI no es retroactiva |
| `euroleague-spc-2024-reference-v1` | **reference-only** | EuroLeague SPC 2024 — <https://elpa.basketball/wp-content/uploads/2024/09/SPC-2024.pdf> | inactivo: solo fixtures |
| `fr-lnb-ccbp-reference-v1` | **reference-only** | LNB/CCBP — <https://cdn.lnb.fr/uploads/content-library/ee8de036b647401bc99a88247438e4ed25de7e000b87709ec31615843b8fbaa9.pdf> | inactivo: fixture de colisión (5 años vs. tope FIBA de 4) |

El convenio ACB/ABP **no se presenta como vigente verificado**: su periodo
formal publicado terminó el 30-06-2022 y su continuidad se aplica con
`resolutionMode: 'provisionalCarryForward'`, warning y badge visible en la
interfaz. Su mínimo de 28.000 EUR se usa como suelo **provisional de
simulación** para el perfil ACB, con traza, y **no se aplica a Primera
FEB**. La regla andorrana de prueba por múltiplo salarial se modela como
**política evaluable** con la tabla de escalones declarada
`notImplemented` — nunca un umbral inventado.

#### Entidad `Contract` y `ContractRegistry`

`src/entities/Contract.js` es una entidad **independiente de Player y
Team**: `id`, `playerId`, `clubId`, fechas (`signedDate`/`startDate`/
`endDate`, civiles ISO e **inclusivas**), `coveredSeasonKeys`,
`guaranteeType`, `probation`, `compensation` (por temporada),
`paymentPolicy` (+ `schedule`), `clauses`, `declaredDocuments`,
`representation`, `minorProtections`, `signingContext` congelado,
`lifecycleEvents` y `provenance`.

`src/core/ContractRegistry.js` es la **fuente canónica**:
`state.contractRegistry`, instancia explícita por partida, nunca un
singleton. `Player` no guarda un `currentContract` duplicado y `Team` no
tiene un array paralelo. "Contrato actual", "contratos del club" y
"nómina" son **consultas derivadas**. El registro rechaza ids vacíos o
duplicados y **contratos solapados** del mismo jugador, ordena el
histórico de forma estable, devuelve siempre las mismas instancias y
conserva los contratos expirados/terminados/anulados.

**Estado derivado, nunca persistido**: `pending` (hoy antes de
`startDate`), `active`, `expired` (hoy después de `endDate`, inclusiva),
`terminated` (evento válido) y `void` (evento de anulación). "Expira
pronto" es una etiqueta de INTERFAZ por umbral, no un estado jurídico.
Llegar a `endDate` **no** saca al jugador de `Team.roster`: esa decisión es
de CYCLE-1/MARKET-1 — implementada por `ContractExpiryService` (9.22), que
procesa la expiración orgánica dentro del ciclo anual, nunca en el
instante exacto de `endDate` sin pasar por una fase real del ciclo.

#### Dinero, fechas y calendario de pagos

- Todo importe es **entero en unidad mínima** (`...Minor`) con moneda ISO
  4217 (`src/utils/Money.js`); EUR usa céntimos y **nunca** se guarda un
  float de euros. Cada cantidad declara base `gross`/`net`/
  `estimated-gross`; los perfiles activos se generan en **bruto** y no hay
  motor fiscal.
- Sumar o prorratear detecta monedas incompatibles; los totales son
  derivados; el reparto de céntimos es determinista y la suma, exacta.
  `Intl.NumberFormat` se usa **solo** en presentación.
- Componentes separados: salario base garantizado, derechos de imagen,
  salario en especie, prima de firma, bonus variables, beneficios no
  salariales y costes de agente. Que una partida sea garantizada no la
  convierte en salario a todos los efectos: cada capa declara qué computa.
- `src/utils/LocalDate.js` maneja fechas **civiles** `YYYY-MM-DD` puras
  (nada de medianoche UTC), fin de mes y años bisiestos, y las claves de
  temporada (`2026-27`, ventana 1-jul → 30-jun, convención **de juego**).
- El generador de calendario de pagos es **puro**: acepta total, número de
  cuotas, primera fecha y periodicidad; genera cuotas exactas en céntimos
  dentro de la vigencia; no crea estado paid/unpaid, ni mora, ni impagos,
  ni avales. ACB usa 10 mensualidades (rango 8-12), Primera FEB 12
  derivadas de la periodicidad legal española, y MoraBanc 12 por la
  intersección con la periodicidad andorrana.

#### Garantía, periodo de prueba y menores

Los contratos iniciales son **plenamente garantizados** (no hay cortes
estilo NBA). El periodo de prueba se valida contra todas las capas y solo
se abre en el **primer contrato profesional** (cantera), donde la política
resuelta —incluida la andorrana dinámica— se ejercita de verdad. No se
crea contrato laboral ordinario para un menor de 16 años: la operación
falla como error de dominio y nunca se corrige la edad en silencio. Los
16-17 llevan marcadores **simulados** de consentimiento (y, en Andorra,
autorización administrativa y certificado médico); no se guardan nombres
ni firmas ficticias de tutores.

#### Cláusulas tipadas

Unión discriminada con validador propio por tipo: `player-release`,
`player-option`, `club-option`, `mutual-option`, `automatic-renewal`,
`relegation-or-nonqualification-out`, `nba-out`, `medical-condition`,
`team-performance-bonus`, `individual-performance-bonus`. Cada cláusula
declara titular, ventana, importe, condiciones, `sourceRuleIds`, estado y
nivel de soporte (**todas `modeled-only` en esta entrega**). Un tipo
desconocido se rechaza; una cláusula que ninguna capa sustenta queda
`unspecified` y **no** se admite. Un buyout contractual **no** es un
transfer fee, y el **derecho de tanteo no existe como cláusula ni como
booleano**: es una máquina de estados aparte, `RightOfFirstRefusalCase`
(MARKET-1, ya implementada — ver 9.19), nunca un campo de `Contract`.

#### Contratos simulados: procedencia y calibración

No hay datos contractuales reales en `data/real/` y **no se ha escrito
nada allí**. Todos los contratos generados llevan
`dataSource: 'simulated-contract-v1'`, `isReal: false`,
`generatorVersion: 'contract-seeder-v1'` y `seedFingerprint`, y la
interfaz muestra siempre:

> Contrato simulado para esta partida; no es un dato contractual real.

El seeder (`src/core/ContractSeeder.js`) es **determinista**: ninguna
decisión usa `Math.random`, todas derivan de un hash estable de
`playerId + clubId + seasonKey + generatorVersion` (los ids de contrato
también). Usa **solo señales visibles** —TMB, edad, percentil de calidad
dentro de su competición y fuerza visible de plantilla—: nunca Potencial,
Ambición, Profesionalidad, `team.reputation` (idéntica en los 36 clubes) ni
`budget`/`salary` del dataset (valen 0 y no son presupuestos reales).

**Perfiles económicos de simulación** (configuración de videojuego, no
fuentes oficiales ni presupuestos reales):

| Competición | Nómina anual garantizada objetivo |
|---|---:|
| ACB | 1.600.000 – 18.000.000 EUR brutos |
| Primera FEB | 220.000 – 1.250.000 EUR brutos |

~~~text
clubStrength   = media de TMB de los ocho mejores jugadores
clubPercentile = percentil de clubStrength dentro de su competición
payrollTarget  = low + (high - low) * clubPercentile ^ 2.2

qualityIndex = clamp((playerTmb - competitionP10) /
                     (competitionP90 - competitionP10), 0, 1)
roleWeight   = 0.35 + 4.65 * qualityIndex ^ 2.4
ageFactor    = <21: 0.92 · 21-22: 0.96 · 23-30: 1.00 · 31-33: 0.95 · >=34: 0.85
weight       = roleWeight * ageFactor
~~~

Proceso: se calcula el mínimo salarial **aplicable por perfil y fecha**, se
reserva para todos los jugadores, se reparte el resto proporcionalmente al
peso y se redondea de forma determinista a **múltiplos de 1.000 EUR**
(trabajando en esa unidad para que la suma sea exacta y ningún salario baje
del mínimo). Si el objetivo no permitiera cumplir los mínimos, **se eleva
el objetivo y se emite un warning de calibración** — nunca se rebaja el
mínimo normativo. Nada de esto se escribe como presupuesto oficial del
club.

Cláusulas simuladas: solo una proporción determinista y limitada de
jugadores jóvenes o de calidad alta recibe `player-release`, y solo si el
perfil la admite; el importe se sitúa entre 2x y 4x la remuneración
garantizada restante por un factor determinista. Bonus, opciones de
club/jugador, NBA out y salida por descenso quedan en fixtures.

#### Puente temporal de tres temporadas

`minimumPlayableRemainingSeasons = 3` es una constante de **staging**
documentada: significa "tres transiciones completas de temporada
disponibles después del arranque". Según la fecha de arranque, los
contratos bootstrap cubren 3 o 4 temporadas, **sin superar nunca el máximo
FIBA de cuatro años**. Es un **puente de datos**, no una distribución
contractual realista ni una renovación automática: la entidad y sus tests
soportan contratos reales de una temporada y su expiración, y **CYCLE-1
retiró el puente** (9.22) al incorporar decisiones de mercado reales
(`ContractExpiryService`, `RenewalService`).

#### Integración con temporada, ascensos y cantera

`startSeason()`: construye equipos y Player Registry (ROSTER-1) → crea
`state.contractRegistry` → valida el contexto laboral de los 36 clubes →
genera y registra los contratos bootstrap → valida identidad, afiliación y
contratos → proyecta nóminas → renderiza.

`closeSeasonAndPrepareNext()`: **no** recrea contratos existentes ni cambia
su `signingContext`; aplica ascensos/descensos (que actualizan
`domesticCompetitionId` en el adaptador de frontera), genera el intake de
cantera, registra cada `Player` y **firma un contrato nuevo para cada
incorporación con el contexto ya actualizado**, y vuelve a validar registro
y nómina. No hay mercado CPU cubriendo expiraciones: si un contrato expira,
el sistema lo muestra, no renueva a nadie.

`team.finances.expenses.playerSalaries` deja de ser un valor editable y
pasa a ser una **proyección** refrescada por una única función desde el
registro (los tests comprueban que coinciden). No se deduce efectivo de
ninguna caja: CONTRACT-1 no mueve dinero.

#### Interfaz

Pantalla **Contratos** (club del usuario): marco laboral aplicable
(jurisdicción del empleador, competición doméstica, perfil, duración
máxima, salario mínimo aplicado con su módulo y estado, cuotas y periodo de
prueba), módulos normativos con sus fuentes y fechas de consulta, avisos y
inconsistencias conocidas, resumen de nómina garantizada / variable
potencial / beneficios / costes de agente, compromisos por temporada,
plantilla contractual y alertas de integridad. Pestaña **Contrato** en la
ficha universal: contrato actual o "Sin contrato", club empleador, estado y
vigencia, desglose por temporada, calendario de cuotas, garantía, prueba,
cláusulas, protección de menores, normativa congelada en la firma e
histórico contractual.

Badges con **texto además de color**: "Simulado", "Vigente verificada",
"Continuidad provisional", "Versión fijada", "No ejecutable". No existe
ningún botón de renovar, fichar, liberar, ejecutar cláusula, tantear o
ceder. Verificado en escritorio (1280×900) y móvil (390×844): las tablas
colapsan a tarjetas y no hay scroll horizontal del documento.

#### Invariantes verificadas

Id único por contrato; `playerId` existe en Player Registry; `clubId`
existe; la misma instancia se resuelve por id, jugador y club; sin
solapamientos; `startDate <= endDate` con `endDate` inclusiva; duración
dentro del máximo resuelto; importes enteros no negativos en unidad
mínima; sin mezcla de monedas; mínimos cumplidos según los componentes que
cada regla clasifica como salario; la especie no reduce indebidamente el
mínimo monetario; el calendario suma exactamente lo planificado; el periodo
de prueba cumple el perfil y cabe en la vigencia; ninguna cláusula
desconocida se acepta; todo afiliado del bootstrap tiene exactamente un
contrato vigente o pendiente; un libre puede tener cero; un contrato
expirado sigue en el registro; ascenso/descenso no reescribe la traza de
una firma anterior; una firma nueva usa el contexto nuevo; MoraBanc
resuelve AD y nunca el RD 1006; ACB y Primera FEB resuelven perfiles
distintos; regla/club/temporada desconocidos no aplican ACB por defecto;
todos los contratos simulados llevan procedencia y aviso; el seeder es
determinista y no usa atributos ocultos; nómina derivada y registro no
divergen; `data/real/` no se modifica.

#### Pruebas

`scripts/test-contract1.js` (102 comprobaciones en 7 grupos: resolver y
bugs heredados, composición, entidad y registro, dinero y pagos, contratos
y cláusulas, seeder, auditorías estáticas de alcance),
`scripts/smoke-contract1.js` (36 clubes reales, 3 temporadas completas con
Copa, Playoffs, ascensos y cantera contratada) y
`scripts/verify-contract1-playwright.js` (escritorio y móvil sobre
`file://`). Regresión: `test-roster1.js`, `smoke-roster1.js`,
`verify-roster1-playwright.js` y los tests/smokes LIFE-1..LIFE-4.

#### Fuera de alcance de CONTRACT-1

Negociación jugador/agente, entidad Agent funcional, ofertas y
contraofertas, derecho de tanteo o preferencia, licencias/cupos/
elegibilidad/vinculados, traspasos, buyout ejecutable, rescisión y
compensaciones, cesiones, Letter of Clearance, ligas extranjeras reales,
overlay operativo de EuroLeague, IA de mercado, renovaciones automáticas,
sustituciones por expiración, retiros y equilibrio poblacional, save/load y
migraciones, motor fiscal, movimientos de caja/impagos/avales, contratos de
entrenadores o staff. Siguiente entrega: **REG-1** (inscripción, licencias,
elegibilidad, cupos y vinculados).

_Migrado de `CLAUDE.md` (líneas 262-317 en el commit base `83b85d1`). Contenido preservado tal cual; ver `docs/reference/LEGACY_MAP.md` para la correspondencia completa con la numeración original._

### Contratos (CONTRACT-1, DESIGN.md 9.17)

- `ContractRegistry` (`src/core/ContractRegistry.js`,
  `state.contractRegistry`) es la fuente CANÓNICA de contratos: nunca
  duplicar un `currentContract` en `Player`/`Team` ni mantener un array
  paralelo de contratos en el equipo. "Contrato actual", "contratos del
  club" y "nómina" son consultas derivadas del registro.
- Contrato, afiliación de plantilla, licencia/inscripción y clearance
  internacional son cuatro conceptos DISTINTOS. Un contrato no concede
  licencia ni mueve a nadie de `Team.roster`.
- El dominio `employment` se resuelve por CLUB + jurisdicción del
  EMPLEADOR + fecha (`ClubEmploymentContextCatalog.js`), nunca por "la
  competición del próximo partido".
- `CompetitionDefinition.organizerCountry` describe al ORGANIZADOR de la
  competición: jamás usarlo como `employerJurisdictionId`.
- **MoraBanc Andorra es el test transfronterizo obligatorio**: compite en
  ACB con empleador en Andorra. Cualquier cambio normativo debe seguir
  resolviéndole AD, sin RD 1006 ni SMI español, con el convenio ACB solo
  como capa de membresía.
- Toda regla está versionada, fechada (`validity`), trazada
  (`trace.fields`) y con `status`. No hay fallback ACB ni selección
  silenciosa de "la última versión": sin coincidencia exacta solo continúa
  quien declare `carryForwardUntilSuperseded`, y con warning.
- Un contrato congela sus módulos de firma (`signingContext`): un
  ascenso/descenso no reescribe la normativa de un contrato anterior; solo
  una firma nueva usa el contexto nuevo.
- Dinero SIEMPRE en unidad mínima entera (`...Minor`) + moneda ISO 4217
  (`src/utils/Money.js`); nunca floats de euros. Los totales se derivan,
  no se guardan.
- Fechas contractuales SIEMPRE civiles ISO `YYYY-MM-DD` e inclusivas
  (`src/utils/LocalDate.js`); el estado del contrato se DERIVA de fechas y
  eventos, nunca se persiste ("expira pronto" es etiqueta de UI).
- Los datos simulados nunca se presentan como reales: todo contrato
  generado lleva `dataSource: 'simulated-contract-v1'`, `isReal: false` y
  el aviso "Contrato simulado para esta partida; no es un dato contractual
  real.". Nunca escribir contratos en `data/real/`.
- El seeder es DETERMINISTA (hash de `playerId+clubId+seasonKey+
  generatorVersion`, sin `Math.random`) y solo usa señales VISIBLES (TMB,
  edad, percentiles de su competición): nunca Potencial, Ambición,
  Profesionalidad, `team.reputation` ni `budget` del dataset.
- Las cláusulas son una unión discriminada tipada con validador propio, y
  hoy todas `modeled-only`. Nunca un booleano tipo `hasTanteo`: el tanteo
  será una máquina de estados en MARKET-1. Un buyout no es un transfer fee.
- No hay renovaciones, traspasos, cesiones ni ejecución de cláusulas
  automáticas antes de sus entregas (MARKET-1/TRANSFER-1/LOAN-1/CYCLE-1);
  la interfaz no debe mostrar controles falsos de esas acciones.
- El puente `minimumPlayableRemainingSeasons = 3` del seeder es staging
  temporal documentado, no una distribución contractual real: CYCLE-1 lo
  retirará.
- Añadir una liga/competición nueva es registrar su
  `CompetitionDefinition`/`RuleModule`/`RulesetBundle` en los catálogos
  existentes — nunca editar `Team.js`, `game.js` ni introducir una rama
  nueva repartida por la UI.
- `DESIGN.md`, `CLAUDE.md` y `CHANGELOG.md` se actualizan en la misma PR
  cuando cambian la arquitectura normativa o las reglas activas.
