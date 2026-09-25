(() => {
  const ALBUM_URL = "https://photos.app.goo.gl/a81nwbuYzQkMCWGA9";

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function fullGuestName(guest) {
    if (!guest) return "";
    return [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim();
  }

  function teamLabel(teamId) {
    const data = window.WEDDING_APP_DATA;
    return data?.teams?.[teamId]?.name || "";
  }

  function renderView({ guest = null, publicMode = false } = {}) {
    const identified = Boolean(guest?.id && guest.id !== "admin-test");
    const team = teamLabel(guest?.team);
    const greeting = identified
      ? `<p class="photos-kicker">${escapeHTML(team ? `EQUIPO ${team}` : "INVITADO")}</p>`
      : `<p class="photos-kicker">ÁLBUM COLABORATIVO</p>`;
    const hello = identified
      ? `<h3>Hola, ${escapeHTML(guest.firstName || fullGuestName(guest))}</h3>`
      : `<h3>Compartí tus fotos y videos</h3>`;

    return `
      <div class="photos-v2 photos-google-v32624" data-photo-root data-public-mode="${publicMode ? "true" : "false"}">
        <section class="photos-hero">
          ${greeting}
          <h2>Fotos del casamiento 📸</h2>
          <p><strong>Tu mirada también hace esta historia ❤️</strong><br>Sumá las fotos y videos que saques durante la fiesta al álbum compartido de Vani &amp; Fede.</p>
        </section>

        <section class="section-card photos-picker-card photos-google-card">
          <div class="photos-picker-icon" aria-hidden="true">📷</div>
          ${hello}
          <p>Todo queda reunido en nuestro álbum de Google Fotos. Podés subir varias fotos y videos de una sola vez.</p>

          <div class="photos-google-actions">
            <a class="photos-google-btn photos-google-btn-primary" href="${ALBUM_URL}" target="_blank" rel="noopener noreferrer" data-google-photos-open="upload">
              <span aria-hidden="true">＋</span>
              <span>Subir fotos y videos</span>
            </a>
            <a class="photos-google-btn photos-google-btn-secondary" href="${ALBUM_URL}" target="_blank" rel="noopener noreferrer" data-google-photos-open="view">
              <span aria-hidden="true">▦</span>
              <span>Ver álbum</span>
            </a>
          </div>

          <div class="photos-google-note">
            <span aria-hidden="true">↗</span>
            <p>Se abrirá Google Fotos. Para agregar contenido, Google puede pedirte iniciar sesión.</p>
          </div>
        </section>

        <section class="section-card photos-google-tip">
          <span aria-hidden="true">❤️</span>
          <div>
            <small>ENTRE TODOS</small>
            <strong>Un mismo álbum, todos los puntos de vista.</strong>
            <p>Subí lo que quieras durante la noche; después vamos a tener todos los recuerdos juntos.</p>
          </div>
        </section>
      </div>`;
  }

  function bindView() {
    // La carga y visualización se gestionan directamente en Google Fotos.
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
    host.classList.remove("hidden");
    host.querySelector("[data-photo-enter-app]")?.addEventListener("click", () => options.onEnterApp?.());
  }

  function renderAdminView() {
    return `
      <section class="section-card photos-google-admin" style="padding:18px">
        <p class="eyebrow">ÁLBUM COLABORATIVO</p>
        <h3 style="margin:4px 0 5px">Google Fotos</h3>
        <p style="margin:0 0 14px">Desde esta versión las fotos de los invitados se gestionan directamente en el álbum compartido de Google Fotos.</p>
        <a class="photos-google-btn photos-google-btn-primary" href="${ALBUM_URL}" target="_blank" rel="noopener noreferrer">
          <span aria-hidden="true">▦</span><span>Abrir álbum de Vani &amp; Fede</span>
        </a>
        <p class="form-note" style="margin-top:10px">Los contadores del uploader anterior dejan de usarse porque la carga ya no pasa por el backend de la app.</p>
      </section>`;
  }

  function bindAdminView() {}
  async function retryFailed() { return false; }

  window.WeddingPhotoUploader = {
    albumUrl: ALBUM_URL,
    renderView,
    bindView,
    mountPublic,
    renderAdminView,
    bindAdminView,
    retryFailed
  };
})();
