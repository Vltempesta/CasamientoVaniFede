(() => {
  const CONFIG = window.WEDDING_APP_CONFIG || {};
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
  const instances = new Map();

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
          <section class="photos-contribution-v32604" data-photo-contribution>
            <span aria-hidden="true">📸</span>
            <div>
              <small>TU APORTE AL ÁLBUM</small>
              <strong>Aportaste <b data-photo-contribution-count>—</b> <em data-photo-contribution-label>fotos</em></strong>
            </div>
          </section>` : ""}

        <section class="section-card photos-picker-card" data-photo-picker-card>
          <div class="photos-picker-icon" aria-hidden="true">📷</div>
          <h3>${identified ? `Hola, ${escapeHTML(guest.firstName || fullGuestName(guest))}` : "Compartí tus fotos"}</h3>
          <p>Elegí una o varias fotos desde tu celular. La app sólo recibe los archivos que selecciones.</p>

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
          <button type="button" class="photos-upload-btn" data-photo-upload>Subir al álbum</button>
          <p class="form-note">Se suben de a una para cuidar la memoria del celular. No modificamos la calidad del archivo original.</p>
        </section>

        <section class="section-card photos-progress-card hidden" data-photo-progress-card>
          <div class="photos-progress-top"><strong data-photo-progress-label>Preparando…</strong><span data-photo-progress-value>0%</span></div>
          <div class="photos-progress-track"><div class="photos-progress-fill" data-photo-progress-fill></div></div>
          <p class="photos-progress-note" data-photo-progress-note>No cierres esta pantalla mientras se están subiendo las fotos.</p>
        </section>

        <section class="section-card photos-success hidden" data-photo-success>
          <span aria-hidden="true">❤️</span>
          <h3>¡Gracias!</h3>
          <p data-photo-success-copy>Tus fotos ya forman parte del álbum de Vani &amp; Fede.</p>
          <button type="button" data-photo-more>Subir más fotos</button>
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
      items: [],
      uploading: false,
      uploadedCount: 0
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
    if (button) button.textContent = `Subir ${state.items.length} ${state.items.length === 1 ? "foto" : "fotos"} al álbum`;
    if (!grid) return;
    grid.innerHTML = state.items.map(item => `
      <div class="photos-preview ${item.status === "uploaded" ? "is-uploaded" : ""} ${item.status === "duplicate" ? "is-duplicate" : ""} ${item.status === "error" ? "is-error" : ""}" data-photo-id="${item.id}">
        <img src="${item.previewUrl}" alt="Vista previa de ${escapeHTML(item.file.name)}">
        ${item.status === "pending" ? `<button type="button" data-photo-remove="${item.id}" aria-label="Quitar ${escapeHTML(item.file.name)}">×</button>` : ""}
        ${item.status === "duplicate" ? `<small>✓ Ya estaba en el álbum</small>` : ""}
        ${item.status === "error" ? `<small>${escapeHTML(item.error || "Error")}</small>` : ""}
      </div>`).join("");
  }

  async function sha256File(file) {
    if (!file || !window.crypto?.subtle) return "";
    try {
      const bytes = await file.arrayBuffer();
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2,"0")).join("");
    } catch (_) {
      return "";
    }
  }

  async function photoHashAlreadyStored(photoHash) {
    if (!photoHash) return false;
    try {
      const response = await jsonp("getPhotoUploadStatus", { photoHash });
      return Boolean(response?.data?.found === true && response?.data?.duplicate === true);
    } catch (_) {
      // Si el backend todavía no fue actualizado, dejamos que la deduplicación del servidor decida.
      return false;
    }
  }

  async function guestContributionCount(guestId) {
    if (!guestId) return 0;
    try {
      const response = await jsonp("getPhotoUploadStatus", { countOnly:"1", guestId });
      return Math.max(0, Number(response?.data?.contributedCount || 0));
    } catch (_) {
      return 0;
    }
  }

  async function refreshContributionCounter(state) {
    const countNode = state.root.querySelector("[data-photo-contribution-count]");
    const labelNode = state.root.querySelector("[data-photo-contribution-label]");
    if (!countNode || !state.guest?.id || state.guest.id === "admin-test") return;
    countNode.textContent = "…";
    const count = await guestContributionCount(state.guest.id);
    countNode.textContent = String(count);
    if (labelNode) labelNode.textContent = count === 1 ? "foto" : "fotos";
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

  function parseResponseText(text) {
    const raw = String(text || "").trim();
    if (!raw) return { ok:true };
    try { return JSON.parse(raw); } catch (_) {}
    const match = raw.match(/^[^(]+\((.*)\)\s*;?$/s);
    if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
    return { ok:true, raw };
  }

  async function postPhoto(payload, onProgress) {
    const endpoint = uploadEndpoint();
    if (!endpoint || !/^https?:/i.test(endpoint)) {
      throw new Error("La subida de fotos todavía no está conectada al Apps Script.");
    }

    // Apps Script Web Apps no exponen CORS de forma fiable para XHR/fetch legible.
    // En particular, escuchar xhr.upload.onprogress puede disparar un preflight OPTIONS,
    // que Apps Script no atiende. Enviamos un POST simple en no-cors y verificamos luego
    // el photoId mediante JSONP. Así mantenemos la carpeta privada sin depender de CORS.
    if (typeof onProgress === "function") onProgress(0.18);

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = window.setTimeout(() => controller?.abort(), 120000);

    try {
      await fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
        signal: controller?.signal
      });
      if (typeof onProgress === "function") onProgress(0.78);
      return { ok:true, opaque:true };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("La foto tardó demasiado en subir.");
      throw new Error("No se pudo enviar la foto al álbum.");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function confirmPhotoStored(photoId) {
    if (!photoId) return { found:false, duplicate:false };
    const waits = [450, 1200, 2200];
    for (const delay of waits) {
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const response = await jsonp("getPhotoUploadStatus", { photoId });
        const data = response?.data || response || {};
        if (data.found === true) return { found:true, duplicate:Boolean(data.duplicate) };
      } catch (_) {}
    }
    return { found:false, duplicate:false };
  }

  function updateProgress(state, currentIndex, currentFraction, label) {
    const total = Math.max(1, state.items.length);
    const overall = Math.min(1, (currentIndex + currentFraction) / total);
    const percent = Math.round(overall * 100);
    const root = state.root;
    root.querySelector("[data-photo-progress-card]")?.classList.remove("hidden");
    const lab = root.querySelector("[data-photo-progress-label]");
    const val = root.querySelector("[data-photo-progress-value]");
    const fill = root.querySelector("[data-photo-progress-fill]");
    if (lab) lab.textContent = label || "Subiendo fotos…";
    if (val) val.textContent = `${percent}%`;
    if (fill) fill.style.width = `${percent}%`;
  }

  async function uploadAll(state) {
    if (state.uploading || !state.items.length) return;
    state.uploading = true;
    const uploadButton = state.root.querySelector("[data-photo-upload]");
    if (uploadButton) uploadButton.disabled = true;
    const optionalName = String(state.root.querySelector("#photoGuestName")?.value || "").trim();
    const guest = state.guest;
    let success = 0;
    let duplicates = 0;
    let failures = 0;
    const batchId = makeId();

    for (let i=0;i<state.items.length;i++) {
      const item = state.items[i];
      if (item.status === "uploaded") { success++; continue; }
      try {
        item.status = "uploading";
        renderSelection(state);
        updateProgress(state, i, 0.03, `Revisando ${i+1} de ${state.items.length}`);

        item.photoHash = item.photoHash || await sha256File(item.file);
        if (item.photoHash && await photoHashAlreadyStored(item.photoHash)) {
          item.status = "duplicate";
          item.error = "";
          duplicates++;
          renderSelection(state);
          updateProgress(state, i + 1, 0, `${success} nuevas · ${duplicates} ya estaban`);
          continue;
        }

        updateProgress(state, i, 0.12, `Subiendo ${i+1} de ${state.items.length}`);
        const base64 = await fileToBase64(item.file);
        const payload = {
          action: "uploadWeddingPhoto",
          photoId: item.id,
          batchId,
          batchIndex: i + 1,
          batchTotal: state.items.length,
          token: CONFIG.PUBLIC_WRITE_TOKEN || "",
          appVersion: "32604",
          submittedAt: new Date().toISOString(),
          guestId: guest?.id || "",
          guestName: guest ? fullGuestName(guest) : optionalName,
          teamId: guest?.team || "",
          teamName: guest?.team ? teamLabel(guest.team) : "",
          originalName: item.file.name,
          mimeType: item.file.type || "image/jpeg",
          size: item.file.size,
          lastModified: item.file.lastModified || 0,
          photoHash: item.photoHash || "",
          dataBase64: base64
        };
        let postError = null;
        try {
          await postPhoto(payload, fraction => updateProgress(state, i, Math.max(.08, fraction), `Subiendo ${i+1} de ${state.items.length}`));
        } catch (error) {
          postError = error;
        }

        updateProgress(state, i, .88, `Confirmando ${i+1} de ${state.items.length}`);
        const stored = await confirmPhotoStored(item.id);
        if (!stored.found) {
          throw postError || new Error("La foto no quedó confirmada en el álbum. Revisá la conexión e intentá nuevamente.");
        }

        item.status = stored.duplicate ? "duplicate" : "uploaded";
        item.error = "";
        if (stored.duplicate) duplicates++;
        else success++;
      } catch (error) {
        item.status = "error";
        item.error = String(error?.message || "Error al subir");
        failures++;
      }
      renderSelection(state);
      updateProgress(state, i + 1, 0, failures ? `${success} listas · ${failures} con error` : `Subiendo ${Math.min(i+2,state.items.length)} de ${state.items.length}`);
      await new Promise(resolve => setTimeout(resolve, 90));
    }

    state.uploading = false;
    if (uploadButton) uploadButton.disabled = false;
    const progressNote = state.root.querySelector("[data-photo-progress-note]");
    if (failures) {
      if (progressNote) progressNote.textContent = `${failures} ${failures === 1 ? "foto no pudo subirse" : "fotos no pudieron subirse"}. Podés tocar “Subir al álbum” para reintentar sólo las fallidas.`;
      if (uploadButton) uploadButton.textContent = `Reintentar ${failures} ${failures === 1 ? "foto" : "fotos"}`;
      return;
    }

    updateProgress(state, state.items.length, 0, "¡Listo!");
    state.root.querySelector("[data-photo-selection]")?.classList.add("hidden");
    state.root.querySelector("[data-photo-progress-card]")?.classList.add("hidden");
    const successCard = state.root.querySelector("[data-photo-success]");
    successCard?.classList.remove("hidden");
    const copy = state.root.querySelector("[data-photo-success-copy]");
    if (copy) {
      if (success > 0 && duplicates > 0) copy.textContent = `Subiste ${success} ${success === 1 ? "foto nueva" : "fotos nuevas"}. ${duplicates} ${duplicates === 1 ? "ya estaba" : "ya estaban"} en el álbum.`;
      else if (success > 0) copy.textContent = `Tus ${success} ${success === 1 ? "foto ya forma" : "fotos ya forman"} parte del álbum de Vani & Fede.`;
      else copy.textContent = `Estas ${duplicates === 1 ? "foto ya estaba" : "fotos ya estaban"} en el álbum ❤️`;
    }
    void refreshContributionCounter(state);
  }

  function reset(state) {
    state.items.forEach(item => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    state.items = [];
    state.uploadedCount = 0;
    state.root.querySelector("[data-photo-success]")?.classList.add("hidden");
    state.root.querySelector("[data-photo-progress-card]")?.classList.add("hidden");
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
      if (event.target.closest("[data-photo-upload]")) { void uploadAll(state); return; }
      if (event.target.closest("[data-photo-more]")) reset(state);
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

  window.WeddingPhotoUploader = { renderView, bindView, mountPublic, renderAdminView, bindAdminView };
})();
