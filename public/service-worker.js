// Self-destruct service worker.
//
// Hintergrund: Frühere App-Versionen haben moeglicherweise einen Service-Worker
// registriert. Aktuell wird er ueberhaupt nicht mehr registriert — alte SWs auf
// User-Geraeten halten aber gecachte JS-Bundles fest und sorgen fuer schwer
// reproduzierbare "Bug-X-funktioniert-nicht-mehr"-Reports nach Deploys.
//
// Dieser SW deregistriert sich selbst beim Activate und loescht alle Caches.
// Sobald jeder User die App einmal geoeffnet hat, ist der alte SW weg und
// der Browser holt wieder frische Files direkt vom Server.
//
// Wenn die App spaeter echte Offline-Faehigkeit braucht, hier komplett neu
// schreiben (mit Versioning + Workbox o.ae.).

const SW_VERSION = "self-destruct-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        console.warn("[sw] cache cleanup failed", e);
      }
      try {
        await self.registration.unregister();
      } catch (e) {
        console.warn("[sw] unregister failed", e);
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          client.navigate(client.url);
        }
      } catch (e) {
        console.warn("[sw] reload clients failed", e);
      }
    })()
  );
});

// Pass everything through; no caching while shutting down.
self.addEventListener("fetch", () => {});

// Touch SW_VERSION so browsers see byte-changes when this file is updated.
self.SW_VERSION = SW_VERSION;
