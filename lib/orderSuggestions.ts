/**
 * Zentrales Lager (Rabenstein): Nachfrage = Verbrauch Teich + Verbrauch Rabenstein,
 * Bestand nur Rabenstein. Teich-Bestand fließt nicht ein.
 *
 * Standard: order = max(0, round(total_usage_7d - stock_rabenstein))
 * Optional: order = max(0, ceil(total_usage_7d * 1.1 - stock_rabenstein))
 */
export const CENTRAL_ORDER_USE_ELEVEN_PERCENT_BUFFER = false;

export function computeCentralWarehouseOrder(input: {
  usageTeich7d: number;
  usageRabenstein7d: number;
  stockRabenstein: number;
}): { totalUsage7d: number; orderQuantity: number } {
  const uT = Math.max(0, Math.round(Number(input.usageTeich7d) || 0));
  const uR = Math.max(0, Math.round(Number(input.usageRabenstein7d) || 0));
  const total = uT + uR;
  const stock = Math.max(0, Math.floor(Number(input.stockRabenstein) || 0));

  if (CENTRAL_ORDER_USE_ELEVEN_PERCENT_BUFFER) {
    const orderQuantity = Math.max(0, Math.ceil(total * 1.1 - stock));
    return { totalUsage7d: total, orderQuantity };
  }
  const orderQuantity = Math.max(0, Math.round(total - stock));
  return { totalUsage7d: total, orderQuantity };
}

/** Ein Platzerl mit eigenem Bestand: max(0, round(Verbrauch 7d − Bestand)). */
export function computeLocalOutletOrder(input: {
  usage7d: number;
  stock: number;
}): { orderQuantity: number } {
  const u = Math.max(0, Math.round(Number(input.usage7d) || 0));
  const s = Math.max(0, Math.floor(Number(input.stock) || 0));
  return { orderQuantity: Math.max(0, Math.round(u - s)) };
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
