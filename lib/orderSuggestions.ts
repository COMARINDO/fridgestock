/**
 * Zentrales (geteiltes) Lager: Teich + Rabenstein bilden gemeinsam den Lagerbestand.
 * Verbrauch kommt aus Teich + Filiale (beide konsumieren aus dem gemeinsamen Lager).
 *
 * Standard: order = max(0, round((usage_teich_7d + usage_filiale_7d) - (stock_rabenstein + stock_teich)))
 * Optional: order = max(0, ceil((total_usage_7d * 1.1) - total_stock))
 */
export const CENTRAL_ORDER_USE_ELEVEN_PERCENT_BUFFER = false;

// Early-stage smoothing: when we have < 7 days of history, blend observed daily usage
// with a conservative baseline to avoid overreacting to short spikes.
export const EARLY_STAGE_FALLBACK_DAILY_USAGE = 0; // units/day
export const EARLY_STAGE_MAX_MULTIPLIER = 2; // safety limit vs observed usage_7d
export const EARLY_STAGE_TARGET_DAYS = 7;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function computeEarlyStageOrder(input: {
  usage7d: number;
  daysCovered: number | null | undefined; // 0..7 (or more; will be clamped)
  stock: number;
  fallbackDailyUsage?: number;
  maxMultiplier?: number;
  targetDays?: number;
}): { demand7d: number; orderQuantity: number } {
  const usage7d = Math.max(0, Math.round(Number(input.usage7d) || 0));
  const stock = Math.max(0, Math.floor(Number(input.stock) || 0));
  const targetDays = Math.max(1, Math.round(Number(input.targetDays ?? EARLY_STAGE_TARGET_DAYS) || 7));
  const fallbackDaily = Math.max(
    0,
    Number(input.fallbackDailyUsage ?? EARLY_STAGE_FALLBACK_DAILY_USAGE) || 0
  );
  const maxMult = Math.max(0, Number(input.maxMultiplier ?? EARLY_STAGE_MAX_MULTIPLIER) || 0);

  const daysCoveredRaw = Number(input.daysCovered ?? 0) || 0;
  const daysCovered = clamp(daysCoveredRaw, 0, targetDays);

  // Normal mode: full coverage -> standard logic (demand=usage7d).
  if (daysCovered >= targetDays) {
    const demand7d = usage7d;
    return { demand7d, orderQuantity: Math.max(0, Math.round(demand7d - stock)) };
  }

  // Observed daily usage from partial window.
  const observedDaily = daysCovered > 0 ? usage7d / daysCovered : 0;
  const confidence = clamp(daysCovered / targetDays, 0, 1);
  const finalDaily = observedDaily * confidence + fallbackDaily * (1 - confidence);
  const demand7d = finalDaily * targetDays;

  let orderQuantity = Math.max(0, Math.round(demand7d - stock));

  // Safety limit vs observed usage in window.
  if (maxMult > 0) {
    const cap = Math.round(usage7d * maxMult);
    orderQuantity = Math.min(orderQuantity, cap);
  }

  return { demand7d, orderQuantity };
}

export function computeCentralWarehouseOrder(input: {
  usageTeich7d: number;
  usageFiliale7d: number;
  daysCoveredTeich?: number | null;
  daysCoveredFiliale?: number | null;
  stockRabenstein: number;
  stockTeich: number;
}): { totalUsage7d: number; orderQuantity: number } {
  const uT = Math.max(0, Math.round(Number(input.usageTeich7d) || 0));
  const uF = Math.max(0, Math.round(Number(input.usageFiliale7d) || 0));
  const totalUsage7d = uT + uF;
  const sR = Math.max(0, Math.floor(Number(input.stockRabenstein) || 0));
  const sT = Math.max(0, Math.floor(Number(input.stockTeich) || 0));
  const totalStock = sR + sT;

  if (CENTRAL_ORDER_USE_ELEVEN_PERCENT_BUFFER) {
    const orderQuantity = Math.max(0, Math.ceil(totalUsage7d * 1.1 - totalStock));
    return { totalUsage7d, orderQuantity };
  }

  // Early-stage smoothing: blend both consumers' coverage into one effective coverage.
  // We conservatively take the max (best) coverage available for the shared warehouse demand signal.
  const daysCovered = Math.max(
    0,
    Number(input.daysCoveredTeich ?? 0) || 0,
    Number(input.daysCoveredFiliale ?? 0) || 0
  );
  const { orderQuantity } = computeEarlyStageOrder({
    usage7d: totalUsage7d,
    daysCovered,
    stock: totalStock,
  });
  return { totalUsage7d, orderQuantity };
}

/** Ein Platzerl mit eigenem Bestand: max(0, round(Verbrauch 7d − Bestand)). */
export function computeLocalOutletOrder(input: {
  usage7d: number;
  stock: number;
  daysCovered?: number | null;
}): { orderQuantity: number } {
  const { orderQuantity } = computeEarlyStageOrder({
    usage7d: input.usage7d,
    daysCovered: input.daysCovered,
    stock: input.stock,
  });
  return { orderQuantity };
}

/**
 * Bestellvorschlag aus 7-Tage-Verbrauch und zuletzt gezähltem Bestand (Snapshot).
 * order_quantity = max(0, usage_7d - estimated_stock)
 */

export type OrderSuggestionResult = {
  dailyUsage: number;
  estimatedStock: number;
  calculatedOrder: number;
};

export function computeOrderSuggestion(input: {
  usage7d: number;
  lastQuantity: number;
  lastCountAt: Date | null;
  now?: Date;
}): OrderSuggestionResult {
  const now = input.now ?? new Date();
  const u = Math.max(0, Number(input.usage7d) || 0);
  const daily = u / 7;
  const lastQ = Math.max(0, Math.round(Number(input.lastQuantity) || 0));

  if (!input.lastCountAt) {
    const estimated = lastQ;
    const calculatedOrder = Math.max(0, Math.round(u - estimated));
    return { dailyUsage: daily, estimatedStock: estimated, calculatedOrder };
  }

  const ms = now.getTime() - input.lastCountAt.getTime();
  const daysSince = Math.max(0, ms / (24 * 60 * 60 * 1000));
  const estimated = Math.max(0, lastQ - daysSince * daily);
  const calculatedOrder = Math.max(0, Math.round(u - estimated));
  return { dailyUsage: daily, estimatedStock: estimated, calculatedOrder };
}
