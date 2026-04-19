"use client";

import { useCallback, useEffect, useState } from "react";
import { getAiToggle } from "@/lib/getAiToggle";

const STORAGE_KEY = "useAiConsumption.v1";
const SYNC_EVENT = "fridge-useAiConsumption-sync";

export function useAiConsumptionToggle(): readonly [
  boolean,
  (updater: boolean | ((prev: boolean) => boolean)) => void,
] {
  const [useAi, setUseAiState] = useState(() =>
    typeof window === "undefined" ? false : getAiToggle()
  );

  useEffect(() => {
    const onSync = () => setUseAiState(getAiToggle());
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const setUseAi = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      setUseAiState((prev) => {
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

  return [useAi, setUseAi];
}
