/**
 * WarPrivacy_v32636.gs
 * Privacidad server-side para Guerra de Equipos.
 *
 * Durante una ronda activa, getData sólo devuelve votos/tiebreaks del equipo
 * del usuario que está viendo la app. Los registros rivales no viajan al navegador.
 * Una vez vencida la ronda, deja pasar todos los votos para que la resolución
 * automática existente funcione sin cambios.
 */

function vfProtectWarVotes_(data, params) {
  data = data || {};
  params = params || {};

  var games = data.gameSubmissions || {};
  var nowMs = new Date().getTime();
  var deadlines = {
    1: new Date('2026-09-28T23:59:00-03:00').getTime(),
    2: new Date('2026-09-30T23:59:00-03:00').getTime()
  };
  var privateRoundByGame = {
    'war-strategy-r1': 1,
    'war-tiebreak-r1': 1,
    'war-strategy-r2': 2,
    'war-tiebreak-r2': 2
  };

  var viewerGuestId = String(params.viewerGuestId || '');
  var requestedTeamId = String(params.viewerTeamId || '');
  var viewerTeamId = vfWarViewerTeam_(data, viewerGuestId, requestedTeamId);
  var allowedTeams = { bosque:true, fuego:true, luz:true, noche:true, agua:true, viento:true };
  if (!allowedTeams[viewerTeamId]) viewerTeamId = '';

  var filtered = {};
  Object.keys(games).forEach(function(key) {
    var record = games[key] || {};
    var gameId = String(record.gameId || '');
    var round = Number(privateRoundByGame[gameId] || 0);
    var privateNow = round && nowMs < Number(deadlines[round] || 0);

    if (!privateNow) {
      filtered[key] = record;
      return;
    }

    // Durante la ronda sólo viaja la estrategia del propio equipo.
    if (viewerTeamId && String(record.teamId || '') === viewerTeamId) {
      filtered[key] = record;
    }
  });

  data.gameSubmissions = filtered;
  data.warPrivacy = {
    enabled: true,
    viewerTeamId: viewerTeamId,
    protectedRounds: [
      nowMs < deadlines[1] ? 1 : null,
      nowMs < deadlines[2] ? 2 : null
    ].filter(function(v) { return v !== null; })
  };

  return data;
}

function vfWarViewerTeam_(data, guestId, fallbackTeamId) {
  guestId = String(guestId || '');
  fallbackTeamId = String(fallbackTeamId || '');

  // Primero intentamos resolver el equipo con datos ya guardados en Sheets.
  var rsvp = data && data.rsvps ? data.rsvps[guestId] : null;
  if (rsvp && rsvp.teamId) return String(rsvp.teamId);

  var profile = data && data.profiles ? data.profiles[guestId] : null;
  if (profile && profile.teamId) return String(profile.teamId);

  var games = data && data.gameSubmissions ? data.gameSubmissions : {};
  var keys = Object.keys(games);
  for (var i = 0; i < keys.length; i++) {
    var row = games[keys[i]] || {};
    if (String(row.guestId || '') === guestId && row.teamId) {
      return String(row.teamId);
    }
  }

  // Fallback para invitados sin registros previos. No es autenticación fuerte;
  // sólo evita romper el flujo actual de acceso por nombre.
  return fallbackTeamId;
}
