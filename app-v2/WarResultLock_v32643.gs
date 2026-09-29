/**
 * WarResultLock_v32643.gs
 * Inmutabilidad server-side de resultados de Guerra.
 *
 * Objetivos:
 * 1) El primer resultado oficial guardado por equipo/ronda queda congelado.
 * 2) Reintentos desde otros celulares no pueden pisarlo.
 * 3) Si ya existen duplicados históricos, getData devuelve siempre el PRIMER
 *    resultado oficial (el canónico), no el último.
 *
 * Requiere dos integraciones pequeñas en Code.gs:
 * - Lectura getData: envolver buildData_ con vfApplyWarCanonicalResults_.
 * - Escrituras: reemplazar handleWrite_(payload) por vfHandleWarResultWrite_(payload)
 *   dentro de los withLock_ de doGet y doPost.
 */

function vfIsWarResultPayload_(payload) {
  payload = payload || {};
  var gameId = String(payload.gameId || '');
  var guestId = String(payload.guestId || '');
  return /^war-strategy-r[12]-result$/.test(gameId) &&
         /^war-r[12]-result-(bosque|fuego|luz|noche|agua|viento)$/.test(guestId);
}

function vfWarCanonicalKey_(record) {
  record = record || {};
  return String(record.guestId || '') + '::' + String(record.gameId || '');
}

function vfFirstWarResultRows_() {
  var allRows = rows_(SHEETS.GAME_SUBMISSIONS) || [];
  var first = {};

  allRows.forEach(function(row) {
    if (!row || !vfIsWarResultPayload_(row)) return;
    var key = vfWarCanonicalKey_(row);
    if (!first[key]) first[key] = row;
  });

  return first;
}

function vfWarHydrateCanonical_(row) {
  var hydrated = hydratePayload_(row || {});

  if (!hydrated.answers && row && row.answersJson) {
    hydrated.answers = parseJsonSafe_(row.answersJson, {});
  }

  hydrated.score = numberOrBlank_(hydrated.score);
  hydrated.bestScore = numberOrBlank_(hydrated.bestScore);
  hydrated.earnedPoints = numberOrBlank_(hydrated.earnedPoints);
  hydrated.maxScore = numberOrBlank_(hydrated.maxScore);

  return normalizeDates_(hydrated);
}

/**
 * Se aplica al resultado de buildData_ antes de privacidad.
 * Restaura el PRIMER resultado oficial si una versión vieja escribió duplicados.
 */
function vfApplyWarCanonicalResults_(data) {
  data = data || {};
  if (!data.gameSubmissions || typeof data.gameSubmissions !== 'object') {
    data.gameSubmissions = {};
  }

  var canonical = vfFirstWarResultRows_();
  Object.keys(canonical).forEach(function(key) {
    data.gameSubmissions[key] = vfWarHydrateCanonical_(canonical[key]);
  });

  data.warResultLock = {
    enabled: true,
    canonicalResults: Object.keys(canonical).length
  };

  return data;
}

/**
 * Wrapper de handleWrite_. Debe ejecutarse DENTRO de withLock_.
 * Si ya existe un resultado para equipo/ronda, devuelve el canónico sin append.
 */
function vfHandleWarResultWrite_(payload) {
  payload = payload || {};

  if (String(payload.action || '') !== 'saveGameSubmission' || !vfIsWarResultPayload_(payload)) {
    return handleWrite_(payload);
  }

  var key = vfWarCanonicalKey_(payload);
  var canonical = vfFirstWarResultRows_();
  var existing = canonical[key];

  if (existing) {
    return {
      sheet: SHEETS.GAME_SUBMISSIONS,
      record: responseRecord_(vfWarHydrateCanonical_(existing)),
      locked: true,
      immutable: true,
      message: 'Resultado de Guerra ya congelado; se conserva el primero.'
    };
  }

  // El caller ya está dentro de withLock_, así que esta primera escritura es atómica.
  return handleWrite_(payload);
}
