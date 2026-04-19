"use client";

import { useEffect } from "react";

/**
 * Belt-and-suspenders Cleanup fuer alte Service Worker und Caches.
 *
 * Auch wenn `public/service-worker.js` sich aktuell selbst deregistriert,
 * gibt es Faelle, in denen ein User die App nach Deploy nie aufruft, der
 * Browser den SW-Update-Check verschlaeft o.ae. Dieser kleine Hook erzwingt
 * beim ersten Mount nach Pageload:
 *
 *   1. Alle vorhandenen Service-Worker-Registrierungen aktualisieren (`update()`).
 *   2. Alle Caches (Cache Storage API) loeschen.
 *
 * Beides ist defensiv gegen Fehler abgesichert — wenn der Browser keinen
 * SW-Support hat oder Caches blockiert sind, passiert nichts.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    void (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            try {
              await reg.update();
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }

      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith("fridge-static-") || k.startsWith("workbox-"))
              .map((k) => caches.delete(k))
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  return null;
}
