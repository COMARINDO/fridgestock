"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "useAdminNavExtras.v1";
const SYNC_EVENT = "fridge-useAdminNavExtras-sync";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Controls visibility of the "Monitoring" and "Debug · Historie" sections
 * in the admin navigation. Default OFF — only the "Aktionen" section is
 * visible, keeping the daily nav free of read-only/debug surfaces.
 */
export function useAdminNavExtrasToggle(): readonly [
  boolean,
  (updater: boolean | ((prev: boolean) => boolean)) => void,
] {
  const [showExtras, setShowExtrasState] = useState<boolean>(() => read());

  useEffect(() => {
    const onSync = () => setShowExtrasState(read());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const setShowExtras = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setShowExtrasState((prev) => {
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

  return [showExtras, setShowExtras];
}
