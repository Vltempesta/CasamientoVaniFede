const CACHE_NAME =
  "vani-fede-static-v32512";
const TEAM_LOGO_CACHE_NAME =
  "vani-fede-team-logos-v1";

const TEAM_LOGO_PATHS = [
  "./assets/team-logos/bosque.png",
  "./assets/team-logos/fuego.png",
  "./assets/team-logos/luz.png",
  "./assets/team-logos/noche.png",
  "./assets/team-logos/agua.png",
  "./assets/team-logos/viento.png"
];

const APP_SHELL = [
  "./index.html",
  "./styles.css?v=32512",
  "./app.js?v=32512",
  "./config.js?v=32512",
  "./data.js?v=32512",
  "./manifest.webmanifest?v=32512",
  "./assets/branding/vyf-seal.png?v=32512",
  "./icons/icon-32.png",
  "./icons/icon-48.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico"
];

function canonicalTeamLogoRequest(
  requestOrPath
) {
  const absoluteUrl = new URL(
    typeof requestOrPath === "string"
      ? requestOrPath
      : requestOrPath.url,
    self.location.href
  );

  absoluteUrl.search = "";
  absoluteUrl.hash = "";

  return new Request(
    absoluteUrl.href,
    { cache: "force-cache" }
  );
}

async function warmTeamLogoCache() {
  const logoCache = await caches.open(
    TEAM_LOGO_CACHE_NAME
  );

  await Promise.all(
    TEAM_LOGO_PATHS.map(
      async path => {
        const canonicalRequest =
          canonicalTeamLogoRequest(path);

        const alreadyCached =
          await logoCache.match(
            canonicalRequest,
            { ignoreSearch: true }
          );

        if (alreadyCached) return;

        const previousCached =
          await caches.match(
            canonicalRequest,
            { ignoreSearch: true }
          );

        if (previousCached) {
          await logoCache.put(
            canonicalRequest,
            previousCached.clone()
          );
          return;
        }

        const response = await fetch(
          canonicalRequest
        );

        if (response?.ok) {
          await logoCache.put(
            canonicalRequest,
            response.clone()
          );
        }
      }
    )
  );
}

async function cacheFirstTeamLogo(
  request
) {
  const logoCache = await caches.open(
    TEAM_LOGO_CACHE_NAME
  );
  const canonicalRequest =
    canonicalTeamLogoRequest(request);

  const cached = await logoCache.match(
    canonicalRequest,
    { ignoreSearch: true }
  );

  if (cached) return cached;

  const previousCached =
    await caches.match(
      canonicalRequest,
      { ignoreSearch: true }
    );

  if (previousCached) {
    await logoCache.put(
      canonicalRequest,
      previousCached.clone()
    );
    return previousCached;
  }

  const response = await fetch(
    canonicalRequest
  );

  if (response?.ok) {
    await logoCache.put(
      canonicalRequest,
      response.clone()
    );
  }

  return response;
}

self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      Promise.all([
        caches
          .open(CACHE_NAME)
          .then(cache =>
            cache.addAll(APP_SHELL)
          ),
        warmTeamLogoCache()
      ]).then(() =>
        self.skipWaiting()
      )
    );
  }
);

self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(
                key =>
                  key !== CACHE_NAME &&
                  key !==
                    TEAM_LOGO_CACHE_NAME
              )
              .map(key =>
                caches.delete(key)
              )
          )
        )
        .then(() =>
          self.clients.claim()
        )
    );
  }
);

self.addEventListener(
  "message",
  event => {
    if (
      event.data?.type ===
      "SKIP_WAITING"
    ) {
      self.skipWaiting();
    }
  }
);

self.addEventListener(
  "fetch",
  event => {
    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (
      url.origin ===
        self.location.origin &&
      url.pathname.includes(
        "/assets/team-logos/"
      )
    ) {
      event.respondWith(
        cacheFirstTeamLogo(request)
      );
      return;
    }

    if (
      url.origin ===
        self.location.origin &&
      url.pathname.endsWith(
        "/version.json"
      )
    ) {
      event.respondWith(
        fetch(
          new Request(
            request,
            { cache: "no-store" }
          )
        )
      );
      return;
    }

    if (
      url.origin !==
      self.location.origin
    ) {
      event.respondWith(fetch(request));
      return;
    }

    const freshRequest = new Request(
      request,
      { cache: "no-store" }
    );

    event.respondWith(
      fetch(freshRequest)
        .then(response => {
          if (
            response &&
            response.ok
          ) {
            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then(cache => {
                if (
                  request.mode ===
                  "navigate"
                ) {
                  cache.put(
                    "./index.html",
                    copy
                  );
                } else {
                  cache.put(
                    request,
                    copy
                  );
                }
              });
          }

          return response;
        })
        .catch(async () => {
          if (
            request.mode ===
            "navigate"
          ) {
            return (
              (
                await caches.match(
                  "./index.html"
                )
              ) ||
              Response.error()
            );
          }

          return (
            (
              await caches.match(
                request
              )
            ) ||
            Response.error()
          );
        })
    );
  }
);
