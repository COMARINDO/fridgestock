import { useEffect, useState } from "react";
import { ORDER_RESERVE_PCT_MAX } from "@/lib/orderSuggestions";

const STORAGE_KEY = "admin.orders.reservePct.v1";
const EVENT_NAME = "admin.orders.reservePct";

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > ORDER_RESERVE_PCT_MAX) return ORDER_RESERVE_PCT_MAX;
  return Math.round(n);
}

function readFromStorage(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 0;
    return clampPct(parseInt(raw, 10));
  } catch {
    return 0;
  }
}

/**
 * Prozentsatz (0..ORDER_RESERVE_PCT_MAX), der zu allen Bestellvorschlägen dazugerechnet wird.
 * Persistenz: localStorage, synchronisiert via Custom-Event zwischen Komponenten.
 */
export function useOrderReservePct(): [number, (next: number) => void] {
  const [pct, setPct] = useState<number>(() => readFromStorage());

  useEffect(() => {
    const onAny = () => setPct(readFromStorage());
    window.addEventListener("storage", onAny);
    window.addEventListener(EVENT_NAME, onAny);
    return () => {
      window.removeEventListener("storage", onAny);
      window.removeEventListener(EVENT_NAME, onAny);
    };
  }, []);

  const set = (next: number) => {
    const val = clampPct(Number(next));
    setPct(val);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(val));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EVENT_NAME));
  };

  return [pct, set];
}
