"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "useArticleTracking.v1";
const SYNC_EVENT = "fridge-useArticleTracking-sync";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Controls visibility of the "Artikel-Tracking" entry in the admin navigation
 * and enables the /admin/article-tracking page surface. Default OFF, so the
 * daily nav stays clean.
 */
export function useArticleTrackingToggle(): readonly [
  boolean,
  (updater: boolean | ((prev: boolean) => boolean)) => void,
] {
  const [enabled, setEnabledState] = useState<boolean>(() => read());

  useEffect(() => {
    const onSync = () => setEnabledState(read());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const setEnabled = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setEnabledState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
        } catch {
          // ignore
        }
        queueMicrotask(() => {
          try {
            window.dispatchEvent(new Event(SYNC_EVENT));
          } catch {
            // ignore
          }
        });
        return next;
      });
    },
    []
  );

  return [enabled, setEnabled];
}
