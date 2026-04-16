/**
 * Zentrales (geteiltes) Lager: Teich + Rabenstein bilden gemeinsam den Lagerbestand.
 * Verbrauch kommt aus Teich + Filiale (beide konsumieren aus dem gemeinsamen Lager).
 *
 * Standard: order = max(0, round((usage_teich_7d + usage_filiale_7d) - (stock_rabenstein + stock_teich)))
 * Optional: order = max(0, ceil((total_usage_7d * 1.1) - total_stock))
 */
export const CENTRAL_ORDER_USE_ELEVEN_PERCENT_BUFFER = false;

export function computeCentralWarehouseOrder(input: {
  usageTeich7d: number;
  usageFiliale7d: number;
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
  const orderQuantity = Math.max(0, Math.round(totalUsage7d - totalStock));
  return { totalUsage7d, orderQuantity };
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
