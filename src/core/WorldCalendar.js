// src/core/WorldCalendar.js
// WORLD-CALENDAR-1 (DESIGN.md 10.14) — cronología MUNDIAL única de una
// carrera: `WorldCalendar` (agregado explícito, nunca un singleton) y
// `WorldCalendarItem` (referencia NORMALIZADA a un hecho fechado ajeno).
// Convención del proyecto: identificadores en inglés, comentarios en
// español.
//
// Qué ES: la autoridad del ORDEN y del CURSOR. Mezcla en una sola cola los
// partidos pendientes de TODAS las Editions/Stages activas y los eventos
// fechados que ya modelan Market/Transfer/Loan, y dice qué toca resolver a
// continuación.
//
// Qué NO es (sección 6/9 del prompt): no simula baloncesto, no decide
// clasificaciones, no mueve jugadores, no redacta noticias y no es una
// segunda base de datos del dominio. Un item NUNCA guarda resultados,
// rosters, instancias `Team`/`Club`/`Player` ni funciones — solo ids,
// instantes y metadatos serializables. El estado real de cada hecho sigue
// viviendo en su fuente propietaria (`CompetitionEngine`,
// `MarketRegistry`, `TransferRegistry`, `LoanRegistry`).
//
// Ningún literal de España/ACB/FEB/`1ª`/`2ª` aparece en este archivo
// (auditado en `scripts/test-world-calendar1.js`).

(function (global) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const GameDateTimeModule = isNode ? require('../utils/GameDateTime.js') : global.BasketManager;

  function GDT() { return GameDateTimeModule.GameDateTime; }

  const SCHEMA_VERSION = '2026.1';
  const ITEM_STATUSES = ['scheduled', 'awaiting-user', 'completed', 'cancelled', 'failed'];

  function compareIds(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  class WorldCalendarItem {
    // `moment`: precisión EXPLÍCITA — un partido tiene instante exacto, un
    // plazo de mercado/contrato conserva su FECHA CIVIL (nunca se le
    // inventa una hora persistida, invariante 10). Para ORDENAR una fecha
    // civil frente a un partido del mismo día se usa el inicio de su día
    // en el huso declarado: así se mantiene la regla inclusiva vigente (una
    // decisión que vence el día del partido bloquea ANTES del partido).
    constructor(data = {}) {
      if (!data.sourceType) throw new Error('WorldCalendarItem: falta "sourceType".');
      if (!data.sourceId) throw new Error('WorldCalendarItem: falta "sourceId".');
      this.sourceType = data.sourceType;
      this.sourceId = String(data.sourceId);
      // Id ESTABLE derivado de (fuente + id de la fuente) — nunca un
      // contador global (invariante 6).
      this.id = data.id || `${this.sourceType}:${this.sourceId}`;
      const moment = data.moment || {};
      if (moment.precision === 'instant') {
        this.momentPrecision = 'instant';
        this.instant = GDT().requireInstant(moment.instant);
        this.timeZoneId = GDT().requireTimeZoneId(moment.timeZoneId);
        this.localDate = GDT().localDateAt(this.instant, this.timeZoneId);
        this.orderingInstant = this.instant;
      } else if (moment.precision === 'date') {
        this.momentPrecision = 'date';
        this.instant = null;
        this.timeZoneId = GDT().requireTimeZoneId(moment.timeZoneId);
        this.localDate = GDT().requireLocalDate(moment.localDate);
        this.orderingInstant = GDT().startOfLocalDay(this.localDate, this.timeZoneId);
      } else {
        throw new Error(
          `WorldCalendarItem "${this.id}": "moment.precision" debe ser 'instant' o 'date' `
          + `(recibido: ${moment.precision}).`,
        );
      }
      this.status = data.status || 'scheduled';
      if (ITEM_STATUSES.indexOf(this.status) === -1) {
        throw new Error(`WorldCalendarItem "${this.id}": estado desconocido "${this.status}".`);
      }
      // A quién AFECTA (solo ids — nunca una copia de `Team`/`Club`).
      const scope = data.attentionScope || {};
      this.attentionScope = {
        teamIds: Object.freeze([...(scope.teamIds || [])]),
        clubIds: Object.freeze([...(scope.clubIds || [])]),
      };
      // Metadatos MÍNIMOS y serializables (ids de competición/edición/
      // fase/participantes cuando es partido; tipo de evento cuando no).
      this.metadata = data.metadata ? { ...data.metadata } : {};
      this.failureReason = data.failureReason || null;
    }

    involvesTeam(teamId) { return this.attentionScope.teamIds.indexOf(teamId) !== -1; }

    involvesClub(clubId) { return this.attentionScope.clubIds.indexOf(clubId) !== -1; }

    isPending() { return this.status === 'scheduled' || this.status === 'awaiting-user' || this.status === 'failed'; }

    toJSON() {
      return {
        id: this.id,
        sourceType: this.sourceType,
        sourceId: this.sourceId,
        momentPrecision: this.momentPrecision,
        instant: this.instant,
        localDate: this.localDate,
        timeZoneId: this.timeZoneId,
        orderingInstant: this.orderingInstant,
        status: this.status,
        attentionScope: { teamIds: [...this.attentionScope.teamIds], clubIds: [...this.attentionScope.clubIds] },
        metadata: { ...this.metadata },
        failureReason: this.failureReason,
      };
    }
  }

  class WorldCalendar {
    // `defaultTimeZoneId`: aportado por la COMPOSICIÓN de la carrera (nunca
    // un país por defecto dentro del core). `initialInstant`: instante de
    // arranque del cursor.
    constructor(data = {}) {
      if (!data.id) throw new Error('WorldCalendar: falta "id" explícito.');
      if (!data.defaultTimeZoneId) {
        throw new Error(
          'WorldCalendar: falta "defaultTimeZoneId" explícito — el core nunca asume un huso/país por defecto '
          + '(lo aporta la composición de la carrera).',
        );
      }
      this.id = data.id;
      this.schemaVersion = data.schemaVersion || SCHEMA_VERSION;
      this.defaultTimeZoneId = GDT().requireTimeZoneId(data.defaultTimeZoneId);
      // Cursor MONOTÓNICO ("lo más tarde que se ha resuelto algo"), nunca
      // retrocede (invariante 4).
      this._currentInstant = GDT().requireInstant(data.initialInstant || new Date(0));
      // Temporadas/ventanas registradas — el MISMO calendario atraviesa el
      // verano y la temporada siguiente (invariante 3).
      this._seasons = [];
      // Índice de items pendientes por id estable.
      this._itemsById = new Map();
      // Ledger ACOTADO de lo ya resuelto, solo para Agenda/diagnóstico — no
      // duplica el resultado (que vive en su fuente), ni crece sin límite.
      this._ledger = [];
      this._ledgerMax = Number.isFinite(data.ledgerMax) ? data.ledgerMax : 400;
    }

    // --- Cursor -----------------------------------------------------------
    get currentInstant() { return this._currentInstant; }

    // Avanza el cursor. NUNCA hacia atrás (una fuente que resuelva fuera de
    // orden no puede mover el reloj al pasado). Devuelve `true` si avanzó.
    advanceTo(instantOrDate) {
      if (!instantOrDate) return false;
      const target = GDT().requireInstant(instantOrDate);
      if (GDT().compare(target, this._currentInstant) <= 0) return false;
      this._currentInstant = target;
      return true;
    }

    // --- Temporadas -------------------------------------------------------
    // `startInstant` de la nueva temporada debe ser POSTERIOR al de la
    // anterior (una temporada nueva nunca arranca antes que la que cerró).
    registerSeason({
      seasonKey, startInstant, timeZoneId, scheduleIds,
    }) {
      if (!seasonKey) throw new Error('WorldCalendar.registerSeason: falta "seasonKey".');
      const instant = GDT().requireInstant(startInstant);
      const zone = GDT().requireTimeZoneId(timeZoneId || this.defaultTimeZoneId);
      const existing = this._seasons.find((s) => s.seasonKey === seasonKey);
      if (existing) {
        if (existing.startInstant !== instant) {
          throw new Error(
            `WorldCalendar.registerSeason: la temporada "${seasonKey}" ya está registrada con inicio `
            + `${existing.startInstant} — no se puede volver a registrar con ${instant}.`,
          );
        }
        return existing;
      }
      const last = this._seasons[this._seasons.length - 1];
      if (last && GDT().compare(instant, last.startInstant) <= 0) {
        throw new Error(
          `WorldCalendar.registerSeason: la temporada "${seasonKey}" arrancaría en ${instant}, no posterior al `
          + `inicio de "${last.seasonKey}" (${last.startInstant}) — el calendario nunca retrocede.`,
        );
      }
      const season = {
        seasonKey, startInstant: instant, timeZoneId: zone, scheduleIds: Object.freeze([...(scheduleIds || [])]),
      };
      this._seasons.push(season);
      return season;
    }

    get seasons() { return this._seasons.map((s) => ({ ...s, scheduleIds: [...s.scheduleIds] })); }

    get currentSeason() { return this._seasons.length ? this._seasons[this._seasons.length - 1] : null; }

    get currentSeasonKey() { return this.currentSeason ? this.currentSeason.seasonKey : null; }

    // --- Items ------------------------------------------------------------
    // Sincronización IDEMPOTENTE de una fuente: los items que la fuente ya
    // no lista dejan de estar pendientes (los resolvió alguien, o su
    // expediente cambió de estado) y los nuevos entran. Nunca se pierde un
    // pendiente que la fuente siga declarando.
    syncSource(sourceType, descriptors) {
      if (!sourceType) throw new Error('WorldCalendar.syncSource: falta "sourceType".');
      const incoming = new Map();
      (descriptors || []).forEach((descriptor) => {
        const item = descriptor instanceof WorldCalendarItem
          ? descriptor
          : new WorldCalendarItem({ ...descriptor, sourceType });
        if (item.sourceType !== sourceType) {
          throw new Error(
            `WorldCalendar.syncSource: la fuente "${sourceType}" declaró un item de "${item.sourceType}".`,
          );
        }
        incoming.set(item.id, item);
      });
      [...this._itemsById.values()]
        .filter((item) => item.sourceType === sourceType && !incoming.has(item.id))
        .forEach((item) => this._itemsById.delete(item.id));
      incoming.forEach((item, id) => {
        const existing = this._itemsById.get(id);
        if (existing) {
          // Un item ya conocido conserva su marca de fallo (para no perder
          // el motivo entre sincronizaciones), pero refresca instante y
          // metadatos desde la fuente propietaria.
          existing.instant = item.instant;
          existing.localDate = item.localDate;
          existing.timeZoneId = item.timeZoneId;
          existing.momentPrecision = item.momentPrecision;
          existing.orderingInstant = item.orderingInstant;
          existing.attentionScope = item.attentionScope;
          existing.metadata = item.metadata;
          return;
        }
        this._itemsById.set(id, item);
      });
      return this._itemsById.size;
    }

    getItem(id) { return this._itemsById.get(id) || null; }

    requireItem(id) {
      const item = this.getItem(id);
      if (!item) throw new Error(`WorldCalendar: no existe item "${id}" en el índice operativo.`);
      return item;
    }

    // ORDEN TOTAL y estable: instante de ordenación, y a igualdad, id.
    // Nunca depende del orden de inserción, de arrays, de `Map`, del país
    // ni de la competición "seleccionada" en la interfaz (invariante 12).
    pendingItemsOrdered() {
      return [...this._itemsById.values()]
        .filter((item) => item.isPending())
        .sort((a, b) => {
          const cmp = GDT().compare(a.orderingInstant, b.orderingInstant);
          return cmp !== 0 ? cmp : compareIds(a.id, b.id);
        });
    }

    // Grupo temporal más antiguo pendiente (todos los items que comparten
    // el instante de ordenación más antiguo), ya ordenado por id.
    earliestPendingGroup() {
      const pending = this.pendingItemsOrdered();
      if (!pending.length) return [];
      const first = pending[0].orderingInstant;
      return pending.filter((item) => item.orderingInstant === first);
    }

    // Items pendientes de un instante concreto (usado tras el commit del
    // partido del usuario para resolver los CPU simultáneos).
    pendingItemsAt(orderingInstant) {
      const target = GDT().requireInstant(orderingInstant);
      return this.pendingItemsOrdered().filter((item) => item.orderingInstant === target);
    }

    markCompleted(id) {
      const item = this.requireItem(id);
      item.status = 'completed';
      item.failureReason = null;
      this._itemsById.delete(id);
      this._ledger.push(item.toJSON());
      if (this._ledger.length > this._ledgerMax) this._ledger.splice(0, this._ledger.length - this._ledgerMax);
      return item;
    }

    // Un fallo NUNCA elimina el item ni permite adelantar el cursor por
    // encima de él (invariante 17) — queda `failed` y sigue en la cola.
    markFailed(id, reason) {
      const item = this.requireItem(id);
      item.status = 'failed';
      item.failureReason = reason || 'error desconocido';
      return item;
    }

    markAwaitingUser(id) {
      const item = this.requireItem(id);
      if (item.status === 'scheduled') item.status = 'awaiting-user';
      return item;
    }

    // Items (pendientes + ledger reciente) que afectan a un equipo, dentro
    // de una ventana de instantes — proyección para Agenda/Home.
    itemsForTeam(teamId, { fromInstant, toInstant } = {}) {
      const inWindow = (orderingInstant) => (
        (!fromInstant || GDT().compare(orderingInstant, fromInstant) >= 0)
        && (!toInstant || GDT().compare(orderingInstant, toInstant) <= 0)
      );
      const pending = this.pendingItemsOrdered()
        .filter((item) => item.involvesTeam(teamId) && inWindow(item.orderingInstant))
        .map((item) => item.toJSON());
      const past = this._ledger
        .filter((entry) => entry.attentionScope.teamIds.indexOf(teamId) !== -1 && inWindow(entry.orderingInstant));
      return [...past, ...pending].sort((a, b) => {
        const cmp = GDT().compare(a.orderingInstant, b.orderingInstant);
        return cmp !== 0 ? cmp : compareIds(a.id, b.id);
      });
    }

    itemsForClub(clubId, { fromInstant, toInstant } = {}) {
      const inWindow = (orderingInstant) => (
        (!fromInstant || GDT().compare(orderingInstant, fromInstant) >= 0)
        && (!toInstant || GDT().compare(orderingInstant, toInstant) <= 0)
      );
      const pending = this.pendingItemsOrdered()
        .filter((item) => item.involvesClub(clubId) && inWindow(item.orderingInstant))
        .map((item) => item.toJSON());
      const past = this._ledger
        .filter((entry) => entry.attentionScope.clubIds.indexOf(clubId) !== -1 && inWindow(entry.orderingInstant));
      return [...past, ...pending].sort((a, b) => {
        const cmp = GDT().compare(a.orderingInstant, b.orderingInstant);
        return cmp !== 0 ? cmp : compareIds(a.id, b.id);
      });
    }

    // Al cerrar temporada, el índice operativo no debe convertirse en otro
    // histórico infinito de partidos: los resultados/históricos/noticias ya
    // viven en sus fuentes. Solo se retira el LEDGER (los pendientes nunca
    // se tiran).
    retireLedger() {
      const retired = this._ledger.length;
      this._ledger = [];
      return retired;
    }

    get ledger() { return this._ledger.map((entry) => ({ ...entry })); }

    // --- Integridad -------------------------------------------------------
    validateIntegrity() {
      const errors = [];
      this._itemsById.forEach((item, id) => {
        if (item.id !== id) errors.push(`item "${id}" indexado con un id distinto del suyo ("${item.id}")`);
        if (item.momentPrecision === 'instant' && !item.instant) {
          errors.push(`item "${id}" declara precisión de instante sin instante`);
        }
        // Invariante 5: ningún item pendiente puede quedar silenciosamente
        // DETRÁS del cursor. Un `failed` sí puede (por eso no avanzó el
        // cursor por encima de él) — se informa aparte.
        if (item.status === 'scheduled' && GDT().compare(item.orderingInstant, this._currentInstant) < 0) {
          errors.push(
            `item pendiente "${id}" está fechado en ${item.orderingInstant}, ANTES del cursor `
            + `${this._currentInstant} — un pendiente nunca puede quedar detrás del cursor`,
          );
        }
      });
      for (let i = 1; i < this._seasons.length; i++) {
        if (GDT().compare(this._seasons[i].startInstant, this._seasons[i - 1].startInstant) <= 0) {
          errors.push(`la temporada "${this._seasons[i].seasonKey}" no arranca después de la anterior`);
        }
      }
      return errors;
    }

    // Plano y serializable (invariante 27 de la EPIC).
    snapshot() {
      return {
        id: this.id,
        schemaVersion: this.schemaVersion,
        defaultTimeZoneId: this.defaultTimeZoneId,
        currentInstant: this._currentInstant,
        seasons: this.seasons,
        pendingItems: this.pendingItemsOrdered().map((item) => item.toJSON()),
        ledgerSize: this._ledger.length,
      };
    }

    // SAVE-LOAD-1: siembra `_itemsById` directamente desde items YA
    // serializados (`WorldCalendarItem.toJSON()`) — nunca vía `syncSource()`
    // (que crearía todo como 'scheduled' por defecto, perdiendo un item
    // `awaiting-user`/`failed` que ninguna fuente puede "re-declarar" con su
    // estado exacto). Debe llamarse ANTES de que el coordinador vuelva a
    // sincronizar las fuentes reales — un `syncSource()` posterior conserva
    // el estado/motivo de fallo de un item ya existente (ver `syncSource`)
    // y solo refresca instante/metadatos, así que el orden es seguro.
    restorePendingItems(itemsJSON) {
      (itemsJSON || []).forEach((json) => {
        const item = new WorldCalendarItem({
          sourceType: json.sourceType,
          sourceId: json.sourceId,
          id: json.id,
          status: json.status,
          moment: json.momentPrecision === 'instant'
            ? { precision: 'instant', instant: json.instant, timeZoneId: json.timeZoneId }
            : { precision: 'date', localDate: json.localDate, timeZoneId: json.timeZoneId },
          attentionScope: json.attentionScope,
          metadata: json.metadata,
          failureReason: json.failureReason,
        });
        this._itemsById.set(item.id, item);
      });
    }

    // SAVE-LOAD-1: restaura el ledger acotado de items ya resueltos (solo
    // Agenda/diagnóstico, nunca autoridad) — entradas ya planas
    // (`WorldCalendarItem.toJSON()`), nunca reconstruidas como instancias.
    restoreLedger(entries) {
      this._ledger = (entries || []).map((entry) => ({ ...entry }));
      if (this._ledger.length > this._ledgerMax) this._ledger.splice(0, this._ledger.length - this._ledgerMax);
    }

    // --- Puentes legacy ---------------------------------------------------
    // La autoridad interna es `currentInstant`; estos getters existen solo
    // para los call-sites históricos que esperan un `Date` (interfaz,
    // Recovery/Training/Development, `LocalDate.fromJsDate`). Frontera
    // ÚNICA — ningún cálculo NUEVO de calendario debe partir de aquí.
    get currentGameDateTime() { return GDT().toJsDate(this._currentInstant); }

    get currentLocalDate() { return GDT().localDateAt(this._currentInstant, this.defaultTimeZoneId); }

    get seasonStartInstant() { return this.currentSeason ? this.currentSeason.startInstant : this._currentInstant; }

    get seasonStartDate() { return GDT().toJsDate(this.seasonStartInstant); }
  }

  const exportsObj = {
    WorldCalendar,
    WorldCalendarItem,
    WORLD_CALENDAR_SCHEMA_VERSION: SCHEMA_VERSION,
    WORLD_CALENDAR_ITEM_STATUSES: ITEM_STATUSES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  } else {
    global.BasketManager = global.BasketManager || {};
    Object.assign(global.BasketManager, exportsObj);
  }
})(typeof window !== 'undefined' ? window : globalThis);
