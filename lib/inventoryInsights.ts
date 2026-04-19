/**
 * Order + performance helpers from 7-day usage (negative diffs) and snapshot stock.
 */

export type ProductPerformance = "dead" | "slow" | "normal" | "fast";

/** Traffic light for stock vs expected weekly usage. */
export type StockSignal = "ok" | "low" | "critical";

const PERF_THRESH = {
  slowMax: 5,
  normalMax: 15,
} as const;

export function classifyProductPerformance(usage7d: number): ProductPerformance {
  const u = Math.max(0, Math.floor(Number(usage7d) || 0));
  if (u === 0) return "dead";
  if (u <= PERF_THRESH.slowMax) return "slow";
  if (u <= PERF_THRESH.normalMax) return "normal";
  return "fast";
}

export function performanceLabel(p: ProductPerformance): string {
  switch (p) {
    case "dead":
      return "Totbestand";
    case "slow":
      return "Langsam";
    case "normal":
      return "Normal";
    case "fast":
      return "Schnell";
    default:
      return "";
  }
}

/** order = max(0, usage - stock), integer. */
export function computeOrderQuantity(usage7d: number, currentStock: number): number {
  const u = Math.max(0, Math.round(Number(usage7d) || 0));
  const s = Math.max(0, Math.round(Number(currentStock) || 0));
  return Math.max(0, u - s);
}

/** Round order up to full crates (e.g. 12 / 24). */
export function roundOrderToCrate(orderQty: number, crateSize: number): number {
  const q = Math.max(0, Math.round(Number(orderQty) || 0));
  const c = Math.max(1, Math.round(Number(crateSize) || 1));
  if (q === 0) return 0;
  return Math.ceil(q / c) * c;
}

/**
 * 🟢 ok: stock >= usage
 * 🟡 low: stock < usage && stock > 0
 * 🔴 critical: stock === 0 && usage > 0 (nothing left but expected consumption)
 */
export function stockSignal(stock: number, usage7d: number): StockSignal {
  const s = Math.max(0, Math.round(Number(stock) || 0));
  const u = Math.max(0, Math.round(Number(usage7d) || 0));
  if (u === 0) return "ok";
  if (s >= u) return "ok";
  if (s === 0) return "critical";
  return "low";
}

export const DEFAULT_CRATE_SIZE = 12 as const;
