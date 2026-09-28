/**
 * Vani & Fede · Staff Security + Staff Scores · v32625
 * NO contiene la contraseña. Guardarla en Apps Script > Project Settings > Script Properties:
 *   VF_STAFF_PASSWORD = (la contraseña acordada)
 *
 * INTEGRACIÓN EN doGet(e), ANTES del switch/ruteo existente:
 *
 * const staffHandled = vfStaffHandleAction_(action, params);
 * if (staffHandled) return jsonResponse_(staffHandled, callback); // usar el helper JSONP existente del proyecto
 *
 * Si tu helper final no se llama jsonResponse_, mantené el mismo mecanismo que ya usa doGet
 * para envolver {ok:true,data:...} con callback JSONP.
 */

function vfStaffHandleAction_(action, params) {
  if (action === 'staffLoginStart') return { ok:true, data:vfStaffLoginStart_(params) };
  if (action === 'staffLoginFinish') return { ok:true, data:vfStaffLoginFinish_(params) };
  if (action === 'staffSaveScore') return { ok:true, data:vfStaffSaveScore_(params) };
  return null;
}

function vfStaffSecret_() {
  const secret = PropertiesService.getScriptProperties().getProperty('VF_STAFF_PASSWORD');
  if (!secret) throw new Error('Acceso de organización no configurado.');
  return String(secret);
}

function vfStaffRole_(role) {
  role = String(role || '').toLowerCase();
  if (role !== 'eugenia' && role !== 'daniela') throw new Error('Usuario no autorizado.');
  return role;
}

function vfStaffHex_(bytes) { return bytes.map(function(b){ return ('0'+(b&255).toString(16)).slice(-2); }).join(''); }
function vfStaffSha256_(text) { return vfStaffHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function vfStaffRandom_() { return Utilities.getUuid() + Utilities.getUuid().replace(/-/g,''); }
function vfStaffCache_() { return CacheService.getScriptCache(); }

function vfStaffLoginStart_(params) {
  const role = vfStaffRole_(params.role);
  const cache = vfStaffCache_();
  const lockKey = 'vf_staff_lock_' + role;
  const lockUntil = Number(cache.get(lockKey) || 0);
  if (lockUntil && Date.now() < lockUntil) throw new Error('Demasiados intentos. Probá nuevamente en unos minutos.');
  const challengeId = Utilities.getUuid();
  const nonce = vfStaffRandom_();
  cache.put('vf_staff_challenge_' + challengeId, JSON.stringify({role:role, nonce:nonce, created:Date.now()}), 120);
  return { challengeId:challengeId, nonce:nonce };
}

function vfStaffLoginFinish_(params) {
  const role = vfStaffRole_(params.role);
  const cache = vfStaffCache_();
  const key = 'vf_staff_challenge_' + String(params.challengeId || '');
  const raw = cache.get(key);
  cache.remove(key); // un solo uso
  if (!raw) throw new Error('El desafío de acceso venció. Volvé a intentar.');
  const challenge = JSON.parse(raw);
  if (challenge.role !== role || Date.now() - Number(challenge.created || 0) > 120000) throw new Error('Acceso vencido.');
  const expected = vfStaffSha256_(vfStaffSecret_() + '|' + challenge.nonce);
  const received = String(params.proof || '').toLowerCase();
  const failKey='vf_staff_fails_'+role;
  let fails=Number(cache.get(failKey)||0);
  if (received !== expected) {
    fails += 1; cache.put(failKey,String(fails),600);
    if (fails >= 5) cache.put('vf_staff_lock_'+role,String(Date.now()+5*60*1000),300);
    throw new Error('Contraseña incorrecta.');
  }
  cache.remove(failKey);
  const token=vfStaffRandom_();
  const tokenHash=vfStaffSha256_(token);
  const ttl=21600; // 6 horas
  cache.put('vf_staff_session_'+tokenHash, JSON.stringify({role:role,created:Date.now()}), ttl);
  return { sessionToken:token, expiresAt:new Date(Date.now()+ttl*1000).toISOString(), role:role };
}

function vfStaffValidate_(token, role) {
  role=vfStaffRole_(role);
  const hash=vfStaffSha256_(String(token||''));
  const raw=vfStaffCache_().get('vf_staff_session_'+hash);
  if (!raw) throw new Error('La sesión de organización venció. Volvé a ingresar.');
  const session=JSON.parse(raw);
  if (session.role !== role) throw new Error('Sesión no autorizada.');
  return session;
}

function vfStaffSaveScore_(params) {
  const payload = JSON.parse(String(params.payload || '{}'));
  const role=vfStaffRole_(payload.role);
  vfStaffValidate_(payload.sessionToken, role);
  const allowedTeams={bosque:1,fuego:1,luz:1,noche:1,agua:1,viento:1};
  const teamId=String(payload.teamId||'');
  if (!allowedTeams[teamId]) throw new Error('Equipo inválido.');
  const points=Number(payload.points||0);
  if (!Number.isFinite(points) || points <= 0 || points > 5000) throw new Error('Puntaje inválido.');
  const activity=String(payload.activity||'staff');
  const allowedActivities={kermesse:1,'juego-mesa-1':1,'juego-mesa-2':1,baile:1,banda:1,ramo:1,whisky:1,espiritu:1};
  if (!allowedActivities[activity]) throw new Error('Actividad inválida.');
  if (role==='eugenia' && activity!=='kermesse') throw new Error('Eugenia sólo puede cargar Kermesse.');
  if (role==='daniela' && activity==='kermesse') throw new Error('Actividad no habilitada para Daniela.');
  if (activity==='kermesse' && points !== Number(payload.tickets||0)*10) throw new Error('Conversión de tickets inválida.');
  if ((activity==='ramo'||activity==='whisky') && points!==250) throw new Error('Puntaje fijo inválido.');
  if (activity==='espiritu' && points!==700) throw new Error('Puntaje fijo inválido.');
  if ((activity==='juego-mesa-1'||activity==='juego-mesa-2') && [100,250,500].indexOf(points)<0) throw new Error('Puntaje de posición inválido.');
  if ((activity==='baile'||activity==='banda') && [50,100,150,200].indexOf(points)<0) throw new Error('Puntaje de performance inválido.');

  const props=PropertiesService.getScriptProperties();
  const spreadsheetId=props.getProperty('WEDDING_SPREADSHEET_ID');
  const ss=spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No se pudo acceder a la planilla del casamiento.');
  const sheet=ss.getSheetByName('PUNTAJES');
  if (!sheet) throw new Error('No existe la hoja PUNTAJES.');
  const values=sheet.getDataRange().getValues();
  const headers=(values[0]||[]).map(function(v){return String(v||'').trim();});
  const now=new Date();
  const record={timestamp:now.toISOString(),gameId:'staff-'+activity,teamId:teamId,points:points,comment:(activity==='kermesse'?Number(payload.tickets||0)+' tickets · ':'')+activity+' · '+role,adminName:role==='eugenia'?'Eugenia':'Daniela',submittedAt:now.toISOString(),appVersion:String(payload.appVersion||'32625'),pageUrl:'',userAgent:'',requestId:String(payload.requestId||Utilities.getUuid()),environment:'production',payloadJson:JSON.stringify({role:role,activity:activity,tickets:Number(payload.tickets||0)})};
  const row=headers.map(function(h){ return Object.prototype.hasOwnProperty.call(record,h) ? record[h] : ''; });
  const lock=LockService.getScriptLock(); lock.waitLock(10000);
  try { sheet.appendRow(row); } finally { lock.releaseLock(); }
  try { CacheService.getScriptCache().remove('ranking'); CacheService.getScriptCache().remove('ranking_v32625'); } catch(_) {}
  return {record:record};
}
