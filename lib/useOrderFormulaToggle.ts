import { useEffect, useState } from "react";

const STORAGE_KEY = "admin.orders.showFormula.v1";
const EVENT_NAME = "admin.orders.showFormula";

function readFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useOrderFormulaToggle(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readFromStorage());

  useEffect(() => {
    const onAny = () => setEnabled(readFromStorage());
    window.addEventListener("storage", onAny);
    window.addEventListener(EVENT_NAME, onAny);
    return () => {
      window.removeEventListener("storage", onAny);
      window.removeEventListener(EVENT_NAME, onAny);
    };
  }, []);

  const set = (next: boolean) => {
    const val = Boolean(next);
    setEnabled(val);
    try {
      window.localStorage.setItem(STORAGE_KEY, val ? "true" : "false");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EVENT_NAME));
  };

  return [enabled, set];
}

