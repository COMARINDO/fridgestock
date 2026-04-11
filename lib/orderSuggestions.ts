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
