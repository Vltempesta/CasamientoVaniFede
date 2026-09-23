(() => {
  "use strict";

  const CARD_CLASS = "home-gifts-feature";

  const cardMarkup = `
    <span class="home-gifts-feature-icon" aria-hidden="true">
      <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 10h16v10H4z"/>
        <path d="M3 7h18v3H3zM12 7v13"/>
        <path d="M12 7c-3.5 0-5-1.1-5-2.6C7 3.2 8 3 8.8 3 10.3 3 12 5.2 12 7Z"/>
        <path d="M12 7c3.5 0 5-1.1 5-2.6C17 3.2 16 3 15.2 3 13.7 3 12 5.2 12 7Z"/>
      </svg>
    </span>
    <span class="home-gifts-feature-copy">
      <strong>Nuestro mejor regalo es tu presencia 🥂</strong>
    </span>
    <b aria-hidden="true">›</b>`;

  function goToGifts() {
    const existingNav =
      document.querySelector('.main-menu [data-route="regalos"]') ||
      document.querySelector('[data-route="regalos"]');
    if (existingNav) {
      existingNav.click();
      return;
    }
    location.hash = "regalos";
  }

  function insertCard() {
    const view = document.getElementById("view");
    const homeEssential = document.getElementById("homeEssential");

    // Only touch the DOM after the original v32608 Home rendered successfully.
    if (!view || !homeEssential) return;
    if (homeEssential.querySelector("." + CARD_CLASS)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = CARD_CLASS;
    button.setAttribute("aria-label", "Abrir información de regalos");
    button.innerHTML = cardMarkup;
    button.addEventListener("click", goToGifts);
    homeEssential.appendChild(button);
  }

  let scheduled = false;
  function scheduleInsert() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      insertCard();
    });
  }

  document.addEventListener("DOMContentLoaded", scheduleInsert);
  window.addEventListener("popstate", scheduleInsert);

  const observer = new MutationObserver(scheduleInsert);
  const startObserver = () => {
    const view = document.getElementById("view");
    if (view) {
      observer.observe(view, { childList: true, subtree: true });
      scheduleInsert();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();