import { describe, expect, it } from "vitest";
import {
  applyOrderReservePct,
  computeCentralWarehouseOrder,
  computeLocalOutletOrder,
  computeOrderSuggestion,
  computeRabensteinGesamtOrderFromDemandReports,
  ORDER_RESERVE_PCT_MAX,
  piecesPerOrderUnitFromProductFields,
} from "./orderSuggestions";

describe("applyOrderReservePct", () => {
  it("returns rounded base when pct is 0/null/undefined/negative", () => {
    expect(applyOrderReservePct(10, 0)).toBe(10);
    expect(applyOrderReservePct(10, null)).toBe(10);
    expect(applyOrderReservePct(10, undefined)).toBe(10);
    expect(applyOrderReservePct(10, -5)).toBe(10);
  });

  it("returns 0 when base <= 0", () => {
    expect(applyOrderReservePct(0, 50)).toBe(0);
    expect(applyOrderReservePct(-3, 50)).toBe(0);
  });

  it("ceils the result when applying pct", () => {
    expect(applyOrderReservePct(20, 10)).toBe(22);
    expect(applyOrderReservePct(20, 5)).toBe(21);
    expect(applyOrderReservePct(7, 10)).toBe(8);
  });

  it("applies large percentages correctly", () => {
    expect(applyOrderReservePct(10, 100)).toBe(20);
    expect(applyOrderReservePct(10, 50)).toBe(15);
  });

  it("ORDER_RESERVE_PCT_MAX is 100", () => {
    expect(ORDER_RESERVE_PCT_MAX).toBe(100);
  });

  it("treats NaN-like inputs as 0", () => {
    expect(applyOrderReservePct(Number.NaN, 10)).toBe(0);
    expect(applyOrderReservePct(10, Number.NaN)).toBe(10);
  });
});

describe("piecesPerOrderUnitFromProductFields", () => {
  it("uses min_quantity if > 0", () => {
    expect(piecesPerOrderUnitFromProductFields({ min_quantity: 12 })).toBe(12);
    expect(
      piecesPerOrderUnitFromProductFields({ min_quantity: 6, metro_unit: "24" })
    ).toBe(6);
  });

  it("falls back to numeric metro_unit when min_quantity is missing or 0", () => {
    expect(piecesPerOrderUnitFromProductFields({ metro_unit: "24" })).toBe(24);
    expect(
      piecesPerOrderUnitFromProductFields({ min_quantity: 0, metro_unit: "12" })
    ).toBe(12);
  });

  it("returns 1 for non-numeric metro_unit and missing min_quantity", () => {
    expect(piecesPerOrderUnitFromProductFields({ metro_unit: "Stk" })).toBe(1);
    expect(piecesPerOrderUnitFromProductFields({})).toBe(1);
    expect(
      piecesPerOrderUnitFromProductFields({ min_quantity: null, metro_unit: null })
    ).toBe(1);
  });
});

describe("computeRabensteinGesamtOrderFromDemandReports", () => {
  it("returns 0 when stock covers demand", () => {
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 0,
        demandFiliale: 0,
        stockRabenstein: 20,
        piecesPerOrderUnit: 24,
      })
    ).toBe(0);
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 5,
        demandFiliale: 5,
        stockRabenstein: 10,
        piecesPerOrderUnit: 24,
      })
    ).toBe(0);
  });

  it("ceils delta divided by pack size", () => {
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 30,
        demandFiliale: 0,
        stockRabenstein: 0,
        piecesPerOrderUnit: 24,
      })
    ).toBe(2);
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 24,
        demandFiliale: 0,
        stockRabenstein: 0,
        piecesPerOrderUnit: 24,
      })
    ).toBe(1);
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 25,
        demandFiliale: 0,
        stockRabenstein: 0,
        piecesPerOrderUnit: 24,
      })
    ).toBe(2);
  });

  it("treats invalid pack size as 1", () => {
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: 5,
        demandFiliale: 0,
        stockRabenstein: 0,
        piecesPerOrderUnit: 0,
      })
    ).toBe(5);
  });

  it("clamps negative inputs to 0 before computing", () => {
    expect(
      computeRabensteinGesamtOrderFromDemandReports({
        demandTeich: -10,
        demandFiliale: -5,
        stockRabenstein: 0,
        piecesPerOrderUnit: 24,
      })
    ).toBe(0);
  });
});

describe("computeCentralWarehouseOrder (full coverage path)", () => {
  it("subtracts total stock from total usage", () => {
    const r = computeCentralWarehouseOrder({
      usageTeich7d: 20,
      usageFiliale7d: 30,
      stockRabenstein: 10,
      stockTeich: 5,
      daysCoveredTeich: 7,
      daysCoveredFiliale: 7,
    });
    expect(r.totalUsage7d).toBe(50);
    expect(r.orderQuantity).toBe(35);
  });

  it("never goes negative", () => {
    const r = computeCentralWarehouseOrder({
      usageTeich7d: 5,
      usageFiliale7d: 5,
      stockRabenstein: 50,
      stockTeich: 0,
      daysCoveredTeich: 7,
      daysCoveredFiliale: 7,
    });
    expect(r.orderQuantity).toBe(0);
  });
});

describe("computeCentralWarehouseOrder (early-stage smoothing)", () => {
  it("returns 0 when no usage observed at all (safety cap = 0)", () => {
    // Wenn nichts beobachtet wurde (usage_7d = 0), greift der Cap usage*maxMult = 0,
    // damit nicht aus Fallback heraus „blind" bestellt wird.
    const r = computeCentralWarehouseOrder({
      usageTeich7d: 0,
      usageFiliale7d: 0,
      stockRabenstein: 0,
      stockTeich: 0,
      daysCoveredTeich: 0,
      daysCoveredFiliale: 0,
    });
    expect(r.orderQuantity).toBe(0);
  });

  it("blends observed daily usage with fallback when coverage is partial and usage > 0", () => {
    // observed 14/7d über 3 Tage → täglicher Schnitt im Fenster ~4.67/d.
    // Confidence sqrt(3/7) ≈ 0.65; fallback 3/d. Demand7d ≈ etwas mehr als usage_7d.
    // Cap = usage * 2 = 28. Result wird positiv aber ≤ 28 sein.
    const r = computeCentralWarehouseOrder({
      usageTeich7d: 14,
      usageFiliale7d: 0,
      stockRabenstein: 0,
      stockTeich: 0,
      daysCoveredTeich: 3,
      daysCoveredFiliale: 0,
    });
    expect(r.orderQuantity).toBeGreaterThan(0);
    expect(r.orderQuantity).toBeLessThanOrEqual(28);
  });

  it("never exceeds usage_7d * maxMultiplier safety cap when usage observed", () => {
    // observed 20 over 1 day → would extrapolate huge, but capped at 20*2 = 40
    const r = computeCentralWarehouseOrder({
      usageTeich7d: 10,
      usageFiliale7d: 10,
      stockRabenstein: 0,
      stockTeich: 0,
      daysCoveredTeich: 1,
      daysCoveredFiliale: 0,
    });
    expect(r.orderQuantity).toBeLessThanOrEqual(40);
  });
});

describe("computeLocalOutletOrder", () => {
  it("returns 0 when stock covers usage (full coverage)", () => {
    expect(
      computeLocalOutletOrder({ usage7d: 5, stock: 10, daysCovered: 7 }).orderQuantity
    ).toBe(0);
  });

  it("subtracts stock from usage at full coverage", () => {
    expect(
      computeLocalOutletOrder({ usage7d: 14, stock: 4, daysCovered: 7 }).orderQuantity
    ).toBe(10);
  });

  it("uses early-stage smoothing when coverage < 7 days", () => {
    const partial = computeLocalOutletOrder({
      usage7d: 7,
      stock: 0,
      daysCovered: 1,
    }).orderQuantity;
    // observed 7/day extrapolated, capped at 7*2 = 14
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThanOrEqual(14);
  });
});

describe("computeOrderSuggestion (snapshot-based)", () => {
  it("falls back to lastQuantity when lastCountAt is null", () => {
    const r = computeOrderSuggestion({
      usage7d: 14,
      lastQuantity: 5,
      lastCountAt: null,
    });
    expect(r.estimatedStock).toBe(5);
    expect(r.calculatedOrder).toBe(9);
    expect(r.dailyUsage).toBeCloseTo(2);
  });

  it("decays estimated stock by daily usage over time", () => {
    const now = new Date("2026-04-19T12:00:00Z");
    const last = new Date("2026-04-12T12:00:00Z"); // 7 days ago
    const r = computeOrderSuggestion({
      usage7d: 14, // 2/day
      lastQuantity: 20,
      lastCountAt: last,
      now,
    });
    // 20 - 7*2 = 6
    expect(r.estimatedStock).toBeCloseTo(6);
    // order = max(0, 14 - 6) = 8
    expect(r.calculatedOrder).toBe(8);
  });

  it("clamps estimated stock to 0 when fully consumed", () => {
    const now = new Date("2026-04-19T12:00:00Z");
    const last = new Date("2026-04-01T12:00:00Z"); // 18 days ago, should consume all
    const r = computeOrderSuggestion({
      usage7d: 14, // 2/day → 36 over 18 days, more than stock
      lastQuantity: 10,
      lastCountAt: last,
      now,
    });
    expect(r.estimatedStock).toBe(0);
    expect(r.calculatedOrder).toBe(14);
  });

  it("never returns negative quantities", () => {
    const r = computeOrderSuggestion({
      usage7d: 0,
      lastQuantity: 50,
      lastCountAt: null,
    });
    expect(r.calculatedOrder).toBe(0);
  });
});
