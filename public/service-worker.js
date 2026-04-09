self.addEventListener("install", () => {
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Cleanup old caches on activate
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fridge-static-") && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

const CACHE = "fridge-static-v2";
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

// Minimal cache-first for static assets (kept intentionally simple).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Avoid caching in local development to prevent stale JS/HMR issues.
  if (DEV_HOSTS.has(self.location.hostname)) return;

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/service-worker.js" ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/apple-icon") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp");

  if (!isStatic) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
  );
});

