(() => {
  const CONFIG = window.WEDDING_APP_CONFIG || {};
  const APP_VERSION = "32606";
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
  const LOCAL_DEDUP_KEY = "vf_photo_fingerprints_v3";
  const ANON_OWNER_KEY = "vf_photo_anon_owner_v1";
  const DB_NAME = "vf_wedding_photo_queue_v1";
  const DB_VERSION = 1;
  const STORE_NAME = "uploads";
  const MAX_CONCURRENT = 2;
  const LARGE_FILE_BYTES = 12 * 1024 * 1024;
  const instances = new Map();
  const listeners = new Set();
  const activeIds = new Set();
  const activeSizes = new Map();
  let pumpScheduled = false;
  let queueReady = false;
  let globalStatusHideTimer = null;

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function fullGuestName(guest) {
    if (!guest) return "";
    return [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim();
  }

  function uploadEndpoint() {
    return CONFIG.PHOTO_UPLOAD_URL || CONFIG.GOOGLE_APPS_SCRIPT_URL || "";
  }

  function teamLabel(teamId) {
    const data = window.WEDDING_APP_DATA;
    return data?.teams?.[teamId]?.name || "";
  }

  function makeId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function anonymousOwnerKey() {
    try {
      let value = localStorage.getItem(ANON_OWNER_KEY) || "";
      if (!value) {
        value = `anon_${makeId()}`;
        localStorage.setItem(ANON_OWNER_KEY, value);
      }
      return value;
    } catch (_) {
      return `anon_session`;
    }
  }

  function ownerKeyForGuest(guest) {
    return guest?.id && guest.id !== "admin-test" ? `guest:${guest.id}` : anonymousOwnerKey();
  }

  function renderView({ guest = null, publicMode = false } = {}) {
    const identified = Boolean(guest?.id && guest.id !== "admin-test");
    const greeting = identified
      ? `<p class="photos-kicker">${escapeHTML(teamLabel(guest.team) ? `EQUIPO ${teamLabel(guest.team)}` : "INVITADO")}</p>`
      : `<p class="photos-kicker">ÁLBUM COLABORATIVO</p>`;

    return `
      <div class="photos-v2" data-photo-root data-public-mode="${publicMode ? "true" : "false"}">
        <section class="photos-hero">
          ${greeting}
          <h2>Fotos del casamiento 📸</h2>
          <p><strong>Tu mirada también hace esta historia ❤️</strong><br>¿Sacaste fotos durante la fiesta? Subilas acá para que queden guardadas en nuestro álbum.</p>
        </section>

        ${identified ? `
          <section class="photos-contribution-v32606" data-photo-contribution>
            <span aria-hidden="true">📸</span>
            <div>
              <small>TU APORTE AL ÁLBUM</small>
              <strong>Aportaste <b data-photo-contribution-count>—</b> <em data-photo-contribution-label>fotos</em></strong>
              <p class="photos-contribution-status hidden" data-photo-contribution-status></p>
            </div>
          </section>` : ""}

        <section class="section-card photos-picker-card" data-photo-picker-card>
          <div class="photos-picker-icon" aria-hidden="true">📷</div>
          <h3>${identified ? `Hola, ${escapeHTML(guest.firstName || fullGuestName(guest))}` : "Compartí tus fotos"}</h3>
          <p>Elegí una o varias fotos. Al tocar subir, quedan en cola y podés seguir usando la app mientras se guardan.</p>

          ${!identified ? `
            <div class="photo-guest-optional">
              <label for="photoGuestName">¿Querés decirnos quién sos? <span>(opcional)</span></label>
              <input id="photoGuestName" type="text" autocomplete="name" placeholder="Tu nombre" maxlength="80">
            </div>` : ""}

          <input data-photo-input type="file" accept="image/*" multiple hidden>
          <button type="button" class="photos-choose-btn" data-photo-choose>Elegir fotos</button>
        </section>

        <section class="section-card photos-picker-card hidden" data-photo-selection>
          <div class="photos-selection-head">
            <strong data-photo-count>0 fotos seleccionadas</strong>
            <button type="button" data-photo-add>Agregar más</button>
          </div>
          <div class="photos-preview-grid" data-photo-grid></div>
          <button type="button" class="photos-upload-btn" data-photo-upload>Enviar al álbum</button>
          <p class="form-note">Conservamos la calidad del archivo original. Las fotos se envían de fondo en una cola segura.</p>
        </section>

        <section class="section-card photos-queue-card hidden" data-photo-queue-card>
          <div class="photos-queue-icon" aria-hidden="true">☁️</div>
          <div class="photos-queue-copy">
            <small>ESTADO DE TUS FOTOS</small>
            <strong data-photo-queue-title>Preparando…</strong>
            <p data-photo-queue-copy>Podés seguir usando la app mientras terminamos.</p>
          </div>
          <button type="button" class="photos-retry-btn hidden" data-photo-retry>Reintentar</button>
        </section>

        <section class="section-card photos-success hidden" data-photo-success>
          <span aria-hidden="true">❤️</span>
          <h3>¡Gracias!</h3>
          <p data-photo-success-copy>Tu selección quedó en cola y se está enviando al álbum.</p>
          <button type="button" data-photo-more>Elegir más fotos</button>
        </section>
      </div>`;
  }

  function createState(root, options) {
    const old = instances.get(root);
    if (old) old.items.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    const state = {
      root,
      guest: options.guest || null,
      publicMode: Boolean(options.publicMode),
      ownerKey: ownerKeyForGuest(options.guest || null),
      items: [],
      enqueuing: false,
      confirmedContribution: 0,
      unsubscribe: null
    };
    instances.set(root, state);
    return state;
  }

  function validPhoto(file) {
    if (!file) return { ok:false, message:"Archivo inválido." };
    const type = String(file.type || "").toLowerCase();
    if (type && !type.startsWith("image/") && !ALLOWED_TYPES.has(type)) return { ok:false, message:`${file.name}: no parece una foto.` };
    if (file.size > MAX_FILE_BYTES) return { ok:false, message:`${file.name}: supera 25 MB.` };
    return { ok:true };
  }

  function appendFiles(state, files) {
    const errors = [];
    Array.from(files || []).forEach(file => {
      const check = validPhoto(file);
      if (!check.ok) { errors.push(check.message); return; }
      const duplicate = state.items.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified);
      if (duplicate) return;
      state.items.push({ id:makeId(), file, previewUrl:URL.createObjectURL(file), status:"pending", error:"" });
    });
    renderSelection(state);
    if (errors.length) window.alert(errors.slice(0,3).join("\n"));
  }

  function renderSelection(state) {
    const {root} = state;
    const selection = root.querySelector("[data-photo-selection]");
    const grid = root.querySelector("[data-photo-grid]");
    const count = root.querySelector("[data-photo-count]");
    const button = root.querySelector("[data-photo-upload]");
    const active = state.items.length > 0;
    selection?.classList.toggle("hidden", !active);
    if (count) count.textContent = `${state.items.length} ${state.items.length === 1 ? "foto seleccionada" : "fotos seleccionadas"}`;
    if (button) {
      button.disabled = state.enqueuing;
      button.textContent = state.enqueuing
        ? "Preparando fotos…"
        : `Enviar ${state.items.length} ${state.items.length === 1 ? "foto" : "fotos"} al álbum`;
    }
    if (!grid) return;
    grid.innerHTML = state.items.map(item => `
      <div class="photos-preview" data-photo-id="${item.id}">
        <img src="${item.previewUrl}" alt="Vista previa de ${escapeHTML(item.file.name)}">
        <button type="button" data-photo-remove="${item.id}" aria-label="Quitar ${escapeHTML(item.file.name)}">×</button>
      </div>`).join("");
  }

  async function sha256Text(value) {
    if (!window.crypto?.subtle) return "";
    try {
      const bytes = new TextEncoder().encode(String(value || ""));
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2,"0")).join("");
    } catch (_) { return ""; }
  }

  async function sourceFingerprint(file) {
    if (!file) return "";
    return sha256Text([
      String(file.name || "").toLowerCase(),
      Number(file.size || 0),
      Number(file.lastModified || 0),
      String(file.type || "").toLowerCase()
    ].join("|"));
  }

  async function visualFingerprint(file) {
    if (!file || !window.crypto?.subtle) return "";
    let bitmap = null;
    let objectUrl = "";
    try {
      if (window.createImageBitmap) bitmap = await createImageBitmap(file);
      let source = bitmap;
      if (!source) {
        objectUrl = URL.createObjectURL(file);
        source = await new Promise((resolve,reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = objectUrl;
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = 9; canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently:true });
      if (!ctx) return "";
      ctx.drawImage(source,0,0,9,8);
      const data = ctx.getImageData(0,0,9,8).data;
      let bits = "";
      for (let y=0;y<8;y++) {
        for (let x=0;x<8;x++) {
          const i=(y*9+x)*4, j=(y*9+x+1)*4;
          const a=data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114;
          const b=data[j]*0.299+data[j+1]*0.587+data[j+2]*0.114;
          bits += a > b ? "1" : "0";
        }
      }
      let hex="";
      for (let i=0;i<64;i+=4) hex += parseInt(bits.slice(i,i+4),2).toString(16);
      return hex.padStart(16,"0");
    } catch (_) {
      return "";
    } finally {
      try { bitmap?.close?.(); } catch (_) {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function loadLocalFingerprints() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_DEDUP_KEY) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch (_) { return new Set(); }
  }

  function rememberLocalFingerprints(...values) {
    try {
      const set = loadLocalFingerprints();
      values.filter(Boolean).forEach(value => set.add(String(value)));
      localStorage.setItem(LOCAL_DEDUP_KEY, JSON.stringify(Array.from(set).slice(-3000)));
    } catch (_) {}
  }

  function localFingerprintSeen(...values) {
    const set = loadLocalFingerprints();
    return values.filter(Boolean).some(value => set.has(String(value)));
  }

  function openQueueDb() {
    return new Promise((resolve,reject) => {
      if (!window.indexedDB) { reject(new Error("Este navegador no permite guardar una cola local.")); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath:"id" });
          store.createIndex("status", "status", { unique:false });
          store.createIndex("ownerKey", "ownerKey", { unique:false });
          store.createIndex("createdAt", "createdAt", { unique:false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir la cola local."));
    });
  }

  async function dbPut(record) {
    const db = await openQueueDb();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(STORE_NAME,"readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => { db.close(); resolve(record); };
      tx.onerror = () => { const err=tx.error; db.close(); reject(err || new Error("No se pudo guardar la foto en la cola.")); };
    });
  }

  async function dbDelete(id) {
    const db = await openQueueDb();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(STORE_NAME,"readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { const err=tx.error; db.close(); reject(err); };
    });
  }

  async function dbAll() {
    const db = await openQueueDb();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(STORE_NAME,"readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => { const rows=req.result || []; db.close(); resolve(rows); };
      req.onerror = () => { const err=req.error; db.close(); reject(err); };
    });
  }

  async function resetInterruptedQueue() {
    const rows = await dbAll();
    const stuck = rows.filter(row => ["uploading","confirming"].includes(row.status));
    await Promise.all(stuck.map(row => dbPut({...row,status:"pending",updatedAt:Date.now(),error:""})));
  }

  function queueSummaryFromRows(rows, ownerKey="") {
    const filtered = ownerKey ? rows.filter(row => row.ownerKey === ownerKey) : rows;
    const summary = { pending:0, uploading:0, confirming:0, error:0, totalActive:0, total:filtered.length };
    filtered.forEach(row => {
      if (Object.prototype.hasOwnProperty.call(summary,row.status)) summary[row.status] += 1;
    });
    summary.totalActive = summary.pending + summary.uploading + summary.confirming;
    return summary;
  }

  async function queueSummary(ownerKey="") {
    try { return queueSummaryFromRows(await dbAll(), ownerKey); }
    catch (_) { return {pending:0,uploading:0,confirming:0,error:0,totalActive:0,total:0}; }
  }

  function emitQueueChange() {
    Promise.resolve(queueSummary()).then(summary => {
      listeners.forEach(fn => { try { fn(summary); } catch (_) {} });
      updateGlobalQueuePill(summary);
    });
  }

  function subscribeQueue(fn) {
    listeners.add(fn);
    void queueSummary().then(summary => fn(summary));
    return () => listeners.delete(fn);
  }

  function ensureGlobalQueuePill() {
    let pill = document.getElementById("vfPhotoQueuePill");
    if (pill) return pill;
    pill = document.createElement("div");
    pill.id = "vfPhotoQueuePill";
    pill.className = "vf-photo-queue-pill hidden";
    pill.setAttribute("role","status");
    pill.setAttribute("aria-live","polite");
    pill.innerHTML = `<span class="vf-photo-queue-pill-icon">📸</span><span class="vf-photo-queue-pill-copy">Fotos</span>`;
    document.body.appendChild(pill);
    return pill;
  }

  function updateGlobalQueuePill(summary) {
    if (!document.body) return;
    const pill = ensureGlobalQueuePill();
    const copy = pill.querySelector(".vf-photo-queue-pill-copy");
    if (globalStatusHideTimer) { clearTimeout(globalStatusHideTimer); globalStatusHideTimer = null; }
    pill.classList.remove("is-error","is-done");
    if (summary.error > 0) {
      pill.classList.remove("hidden");
      pill.classList.add("is-error");
      if (copy) copy.textContent = `${summary.error} ${summary.error === 1 ? "foto necesita" : "fotos necesitan"} reintento`;
      return;
    }
    if (summary.totalActive > 0) {
      pill.classList.remove("hidden");
      if (copy) copy.textContent = `${summary.totalActive} ${summary.totalActive === 1 ? "foto enviándose" : "fotos enviándose"}`;
      return;
    }
    if (!pill.classList.contains("hidden")) {
      pill.classList.add("is-done");
      if (copy) copy.textContent = "Fotos guardadas ✓";
      globalStatusHideTimer = setTimeout(() => pill.classList.add("hidden"), 4500);
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la foto."));
      reader.onload = () => {
        const value = String(reader.result || "");
        const idx = value.indexOf(",");
        resolve(idx >= 0 ? value.slice(idx + 1) : value);
      };
      reader.readAsDataURL(file);
    });
  }

  async function postPhoto(payload) {
    const endpoint = uploadEndpoint();
    if (!endpoint || !/^https?:/i.test(endpoint)) throw new Error("La subida de fotos todavía no está conectada al Apps Script.");
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = window.setTimeout(() => controller?.abort(), 120000);
    try {
      await fetch(endpoint, {
        method:"POST",
        mode:"no-cors",
        credentials:"omit",
        redirect:"follow",
        headers:{"Content-Type":"text/plain;charset=UTF-8"},
        body:JSON.stringify(payload),
        signal:controller?.signal
      });
      return {ok:true,opaque:true};
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("La foto tardó demasiado en subir.");
      throw new Error("No se pudo enviar la foto al álbum.");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function confirmPhotoStored(photoId) {
    if (!photoId) return {found:false,duplicate:false};
    const waits = [0, 300, 850, 1700, 3000];
    for (const delay of waits) {
      if (delay) await new Promise(resolve => setTimeout(resolve,delay));
      try {
        const response = await jsonp("getPhotoUploadStatus", { photoId });
        const data = response?.data || response || {};
        if (data.found === true) return {found:true,duplicate:Boolean(data.duplicate)};
      } catch (_) {}
    }
    return {found:false,duplicate:false};
  }

  async function uploadQueueRecord(record) {
    const current = {...record,status:"uploading",updatedAt:Date.now(),error:""};
    await dbPut(current);
    emitQueueChange();

    const file = current.file;
    if (!file) throw new Error("La foto pendiente ya no está disponible en este dispositivo.");

    const srcFp = current.sourceFingerprint || await sourceFingerprint(file);
    if (srcFp && localFingerprintSeen(srcFp)) {
      rememberLocalFingerprints(srcFp);
      await dbDelete(current.id);
      emitQueueChange();
      return {duplicate:true,local:true};
    }

    // La huella visual se calcula en segundo plano. No hacemos una consulta previa al servidor:
    // el backend vuelve a calcular SHA-256 real y decide si ya existe antes de crear el archivo.
    const visFp = current.visualFingerprint || await visualFingerprint(file);
    await dbPut({...current,sourceFingerprint:srcFp,visualFingerprint:visFp});

    const base64 = await fileToBase64(file);
    const payload = {
      action:"uploadWeddingPhoto",
      photoId:current.id,
      batchId:current.batchId,
      batchIndex:current.batchIndex,
      batchTotal:current.batchTotal,
      token:CONFIG.PUBLIC_WRITE_TOKEN || "",
      appVersion:APP_VERSION,
      submittedAt:new Date().toISOString(),
      guestId:current.guestId || "",
      guestName:current.guestName || "",
      teamId:current.teamId || "",
      teamName:current.teamName || "",
      originalName:file.name || current.originalName || "foto",
      mimeType:file.type || current.mimeType || "image/jpeg",
      size:file.size || current.size || 0,
      lastModified:file.lastModified || current.lastModified || 0,
      sourceFingerprint:srcFp || "",
      visualFingerprint:visFp || "",
      dataBase64:base64
    };

    await postPhoto(payload);
    await dbPut({...current,status:"confirming",sourceFingerprint:srcFp,visualFingerprint:visFp,updatedAt:Date.now(),error:""});
    emitQueueChange();
    const stored = await confirmPhotoStored(current.id);
    if (!stored.found) throw new Error("Todavía no pudimos confirmar esta foto en el álbum.");

    rememberLocalFingerprints(srcFp, visFp);
    await dbDelete(current.id);
    emitQueueChange();
    return stored;
  }

  function canStartRecord(record) {
    if (activeIds.size >= MAX_CONCURRENT) return false;
    const size = Number(record?.size || record?.file?.size || 0);
    const activeLarge = Array.from(activeSizes.values()).some(v => v > LARGE_FILE_BYTES);
    if (activeLarge) return false;
    if (size > LARGE_FILE_BYTES && activeIds.size > 0) return false;
    return true;
  }

  async function runRecord(record) {
    activeIds.add(record.id);
    activeSizes.set(record.id, Number(record?.size || record?.file?.size || 0));
    try {
      await uploadQueueRecord(record);
    } catch (error) {
      const latestRows = await dbAll().catch(() => []);
      const latest = latestRows.find(row => row.id === record.id) || record;
      const attempts = Number(latest.attempts || 0) + 1;
      const nextStatus = attempts <= 1 ? "pending" : "error";
      await dbPut({...latest,status:nextStatus,attempts,updatedAt:Date.now(),error:String(error?.message || "No se pudo subir")}).catch(()=>{});
      emitQueueChange();
      if (nextStatus === "pending") setTimeout(schedulePump, 1200);
    } finally {
      activeIds.delete(record.id);
      activeSizes.delete(record.id);
      schedulePump();
    }
  }

  async function pumpQueue() {
    pumpScheduled = false;
    let rows;
    try { rows = await dbAll(); } catch (_) { return; }
    const candidates = rows
      .filter(row => row.status === "pending" && !activeIds.has(row.id))
      .sort((a,b) => Number(a.createdAt||0) - Number(b.createdAt||0));
    for (const record of candidates) {
      if (!canStartRecord(record)) break;
      void runRecord(record);
    }
    emitQueueChange();
  }

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => void pumpQueue(), 40);
  }

  async function enqueueSelected(state) {
    if (state.enqueuing || !state.items.length) return;
    state.enqueuing = true;
    renderSelection(state);
    const optionalName = String(state.root.querySelector("#photoGuestName")?.value || "").trim();
    const guest = state.guest;
    const batchId = makeId();
    const selected = state.items.slice();

    // Feedback inmediato: la selección deja de sentirse como una pantalla bloqueada.
    state.root.querySelector("[data-photo-success]")?.classList.remove("hidden");
    const successCopy = state.root.querySelector("[data-photo-success-copy]");
    if (successCopy) successCopy.textContent = `Recibimos tu selección de ${selected.length} ${selected.length === 1 ? "foto" : "fotos"}. Se ${selected.length === 1 ? "está enviando" : "están enviando"} al álbum en segundo plano.`;

    try {
      for (let i=0;i<selected.length;i++) {
        const item = selected[i];
        const srcFp = await sourceFingerprint(item.file);
        if (srcFp && localFingerprintSeen(srcFp)) continue;
        await dbPut({
          id:item.id,
          ownerKey:state.ownerKey,
          createdAt:Date.now()+i,
          updatedAt:Date.now(),
          status:"pending",
          attempts:0,
          error:"",
          batchId,
          batchIndex:i+1,
          batchTotal:selected.length,
          guestId:guest?.id || "",
          guestName:guest ? fullGuestName(guest) : optionalName,
          teamId:guest?.team || "",
          teamName:guest?.team ? teamLabel(guest.team) : "",
          originalName:item.file.name,
          mimeType:item.file.type || "image/jpeg",
          size:item.file.size,
          lastModified:item.file.lastModified || 0,
          sourceFingerprint:srcFp || "",
          visualFingerprint:"",
          file:item.file
        });
      }
      state.items.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      state.items = [];
      state.root.querySelector("[data-photo-selection]")?.classList.add("hidden");
      renderSelection(state);
      emitQueueChange();
      schedulePump();
      void refreshContributionCounter(state);
    } catch (error) {
      if (successCopy) successCopy.textContent = "No pudimos preparar todas las fotos en este dispositivo. Revisá el espacio disponible e intentá nuevamente.";
      window.alert(error?.message || "No se pudieron preparar las fotos.");
    } finally {
      state.enqueuing = false;
      renderSelection(state);
      void refreshQueueCard(state);
    }
  }

  async function retryFailed(ownerKey="") {
    const rows = await dbAll();
    const failed = rows.filter(row => row.status === "error" && (!ownerKey || row.ownerKey === ownerKey));
    await Promise.all(failed.map(row => dbPut({...row,status:"pending",attempts:0,error:"",updatedAt:Date.now()})));
    emitQueueChange();
    schedulePump();
  }

  async function guestContributionCount(guestId) {
    if (!guestId) return 0;
    try {
      const response = await jsonp("getPhotoUploadStatus", { countOnly:"1", guestId });
      return Math.max(0, Number(response?.data?.contributedCount || 0));
    } catch (_) { return 0; }
  }

  async function refreshContributionCounter(state) {
    const countNode = state.root.querySelector("[data-photo-contribution-count]");
    const labelNode = state.root.querySelector("[data-photo-contribution-label]");
    const statusNode = state.root.querySelector("[data-photo-contribution-status]");
    if (!state.guest?.id || state.guest.id === "admin-test") {
      void refreshQueueCard(state);
      return;
    }
    if (countNode) countNode.textContent = "…";
    const [count, summary] = await Promise.all([guestContributionCount(state.guest.id), queueSummary(state.ownerKey)]);
    state.confirmedContribution = count;
    if (countNode) countNode.textContent = String(count);
    if (labelNode) labelNode.textContent = count === 1 ? "foto" : "fotos";
    if (statusNode) {
      statusNode.classList.toggle("hidden", summary.totalActive === 0 && summary.error === 0);
      if (summary.error) statusNode.textContent = `${summary.error} ${summary.error === 1 ? "foto necesita" : "fotos necesitan"} reintento.`;
      else if (summary.totalActive) statusNode.textContent = `${summary.totalActive} ${summary.totalActive === 1 ? "foto se está enviando" : "fotos se están enviando"}…`;
      else statusNode.textContent = "";
    }
    void refreshQueueCard(state, summary);
  }

  async function refreshQueueCard(state, providedSummary=null) {
    const card = state.root.querySelector("[data-photo-queue-card]");
    if (!card) return;
    const summary = providedSummary || await queueSummary(state.ownerKey);
    const title = card.querySelector("[data-photo-queue-title]");
    const copy = card.querySelector("[data-photo-queue-copy]");
    const retry = card.querySelector("[data-photo-retry]");
    const visible = summary.totalActive > 0 || summary.error > 0;
    card.classList.toggle("hidden", !visible);
    card.classList.toggle("is-error", summary.error > 0);
    retry?.classList.toggle("hidden", summary.error === 0);
    if (summary.error > 0) {
      if (title) title.textContent = `${summary.error} ${summary.error === 1 ? "foto necesita" : "fotos necesitan"} reintento`;
      if (copy) copy.textContent = "Las demás fotos pueden seguir enviándose normalmente.";
      if (retry) retry.textContent = `Reintentar ${summary.error}`;
    } else if (summary.totalActive > 0) {
      if (title) title.textContent = `${summary.totalActive} ${summary.totalActive === 1 ? "foto enviándose" : "fotos enviándose"}`;
      if (copy) copy.textContent = "Podés navegar por la app. Te avisamos cuando terminen.";
    }
  }

  function resetSelection(state) {
    state.items.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    state.items = [];
    state.root.querySelector("[data-photo-success]")?.classList.add("hidden");
    renderSelection(state);
  }

  function bindView(root, options = {}) {
    if (!root) return;
    const state = createState(root, options);
    void refreshContributionCounter(state);
    const input = root.querySelector("[data-photo-input]");
    const choose = root.querySelector("[data-photo-choose]");
    const add = root.querySelector("[data-photo-add]");
    choose?.addEventListener("click", () => input?.click());
    add?.addEventListener("click", () => input?.click());
    input?.addEventListener("change", event => {
      appendFiles(state, event.target.files);
      event.target.value = "";
    });
    root.addEventListener("click", event => {
      const remove = event.target.closest("[data-photo-remove]");
      if (remove) {
        const id = remove.dataset.photoRemove;
        const idx = state.items.findIndex(item => item.id === id);
        if (idx >= 0) {
          const [item] = state.items.splice(idx,1);
          item.previewUrl && URL.revokeObjectURL(item.previewUrl);
          renderSelection(state);
        }
        return;
      }
      if (event.target.closest("[data-photo-upload]")) { void enqueueSelected(state); return; }
      if (event.target.closest("[data-photo-more]")) { resetSelection(state); input?.click(); return; }
      if (event.target.closest("[data-photo-retry]")) { void retryFailed(state.ownerKey); return; }
    });
    let previousActive = null;
    state.unsubscribe = subscribeQueue(() => {
      void queueSummary(state.ownerKey).then(summary => {
        void refreshQueueCard(state, summary);
        const statusNode = state.root.querySelector("[data-photo-contribution-status]");
        if (statusNode) {
          statusNode.classList.toggle("hidden", summary.totalActive === 0 && summary.error === 0);
          if (summary.error) statusNode.textContent = `${summary.error} ${summary.error === 1 ? "foto necesita" : "fotos necesitan"} reintento.`;
          else if (summary.totalActive) statusNode.textContent = `${summary.totalActive} ${summary.totalActive === 1 ? "foto se está enviando" : "fotos se están enviando"}…`;
          else statusNode.textContent = "";
        }
        if (previousActive !== null && previousActive > 0 && summary.totalActive === 0 && summary.error === 0) {
          void refreshContributionCounter(state);
        }
        previousActive = summary.totalActive;
      });
    });
  }

  function mountPublic(host, options = {}) {
    if (!host) return;
    host.innerHTML = `
      <div class="photos-public-shell">
        <div class="photos-public-inner">
          <div class="photos-public-brand"><strong>VANI &amp; FEDE</strong><small>24 · 10 · 2026</small></div>
          ${renderView({guest:null,publicMode:true})}
          <button type="button" class="photos-public-enter" data-photo-enter-app>Entrar al resto de la app</button>
        </div>
      </div>`;
    bindView(host.querySelector("[data-photo-root]"), {guest:null,publicMode:true});
    host.classList.remove("hidden");
    host.querySelector("[data-photo-enter-app]")?.addEventListener("click", () => options.onEnterApp?.());
  }

  function jsonp(action, params={}) {
    return new Promise((resolve,reject) => {
      const endpoint = CONFIG.GOOGLE_APPS_SCRIPT_URL || "";
      if (!endpoint) { reject(new Error("Backend no configurado")); return; }
      const cb = `__vfPhotos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(endpoint);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", cb);
      url.searchParams.set("token", CONFIG.PUBLIC_WRITE_TOKEN || "");
      url.searchParams.set("_ts", Date.now());
      Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v ?? ""));
      const script = document.createElement("script");
      const timer = setTimeout(() => clean(() => reject(new Error("La consulta de fotos tardó demasiado."))), 15000);
      function clean(done){ clearTimeout(timer); delete window[cb]; script.remove(); done?.(); }
      window[cb] = payload => clean(() => payload?.ok === false ? reject(new Error(payload.error || "Error")) : resolve(payload));
      script.onerror = () => clean(() => reject(new Error("No se pudo consultar el módulo de fotos.")));
      script.src = url.toString(); document.body.appendChild(script);
    });
  }

  function renderAdminView() {
    return `
      <section class="section-card" style="padding:18px">
        <p class="eyebrow">ÁLBUM COLABORATIVO</p>
        <h3 style="margin:4px 0 5px">Fotos recibidas</h3>
        <p style="margin:0">Resumen de cargas. Las fotos originales permanecen en la carpeta privada de Drive.</p>
      </section>
      <div data-photo-admin-content style="margin-top:12px">
        <section class="section-card" style="padding:18px">Cargando resumen de fotos…</section>
      </div>`;
  }

  async function bindAdminView(root, options = {}) {
    const host = root?.querySelector?.("[data-photo-admin-content]");
    if (!host) return;
    try {
      const response = await jsonp("getPhotoSummary", { adminPassword: options.adminPassword || "" });
      const data = response?.data || response?.details || response || {};
      const recent = Array.isArray(data.recentUploads) ? data.recentUploads : [];
      host.innerHTML = `
        <div class="admin-photo-overview">
          <article><small>Fotos recibidas</small><strong>${Number(data.totalPhotos || 0)}</strong></article>
          <article><small>Personas identificadas</small><strong>${Number(data.identifiedGuests || 0)}</strong></article>
          <article><small>Cargas</small><strong>${Number(data.totalUploads || 0)}</strong></article>
        </div>
        <section class="section-card" style="padding:16px">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px"><div><p class="eyebrow">ÚLTIMAS CARGAS</p><h4 style="margin:3px 0 0">Actividad reciente</h4></div><small>${escapeHTML(data.lastUploadLabel || "")}</small></div>
          <div class="admin-photo-list">
            ${recent.length ? recent.map(row => `<div class="admin-photo-row"><div><strong>${escapeHTML(row.guestName || "Invitado QR")}${row.teamName ? ` · ${escapeHTML(row.teamName)}` : ""}</strong><small>${escapeHTML(row.timestampLabel || row.timestamp || "")}</small></div><b>${Number(row.photoCount || 1)} ${Number(row.photoCount || 1) === 1 ? "foto" : "fotos"}</b></div>`).join("") : `<p style="font-size:11px;margin:0">Todavía no hay fotos recibidas.</p>`}
          </div>
          ${data.folderUrl ? `<a class="admin-photo-open-drive" href="${escapeHTML(data.folderUrl)}" target="_blank" rel="noopener">Abrir carpeta en Google Drive</a>` : ""}
        </section>`;
    } catch (error) {
      host.innerHTML = `<section class="section-card" style="padding:18px"><strong>No se pudo consultar el resumen.</strong><p style="margin:5px 0 0;font-size:11px">${escapeHTML(error?.message || "Revisá la conexión del módulo de fotos.")}</p></section>`;
    }
  }

  async function initQueue() {
    if (queueReady) return;
    queueReady = true;
    try {
      await resetInterruptedQueue();
      emitQueueChange();
      schedulePump();
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void initQueue(), {once:true});
  else void initQueue();

  window.addEventListener("online", () => schedulePump());
  window.WeddingPhotoUploader = { renderView, bindView, mountPublic, renderAdminView, bindAdminView, retryFailed };
})();
