"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
import { useRouter } from "next/navigation";
import {
  getGlobalOverviewByProduct,
  getWeeklyUsageByLocationProduct,
  listInventoryAll,
  listLocations,
  updateProduct,
  updateProductBarcode,
} from "@/lib/db";
import type { Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import JsBarcode from "jsbarcode";
import { suggestShortName } from "@/lib/shortName";
import { formatProductName } from "@/lib/formatProductName";
import {
  classifyProductPerformance,
  computeOrderQuantity,
  performanceLabel,
  roundOrderToCrate,
  stockSignal,
  DEFAULT_CRATE_SIZE,
} from "@/lib/inventoryInsights";
import { useAdmin } from "@/app/admin-provider";
import { useAuth } from "@/app/providers";

type Row = Product & { quantity: number };

export default function OverviewPage() {
  return (
    <RequireAuth>
      <OverviewInner />
    </RequireAuth>
  );
}

function OverviewInner() {
  const { isAdmin } = useAdmin();
  const { location } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [parentLocations, setParentLocations] = useState<Location[]>([]);
  const [stockByLocationProduct, setStockByLocationProduct] = useState<
    Record<string, Record<string, number>>
  >({});
  const [forecastByLocationProduct, setForecastByLocationProduct] = useState<
    Record<string, Record<string, number>>
  >({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchStartRef = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
    scrollLock: boolean;
  } | null>(null);
  const [swipeFx, setSwipeFx] = useState<{ id: string; t: number } | null>(null);
  const [swipeHint, setSwipeHint] = useState<{ id: string; opacity: number } | null>(
    null
  );

  const [sortMode, setSortMode] = useState<"name" | "order" | "usage">("order");

  const [detailOpen, setDetailOpen] = useState<{
    productId: string;
    title: string;
    total: number;
    forecastTotal: number;
    orderTotal: number;
  } | null>(null);

  const [editOpen, setEditOpen] = useState<{
    productId: string;
    brand: string;
    product_name: string;
    zusatz: string;
    barcode: string;
    short_name: string;
  } | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [barcodeModal, setBarcodeModal] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  const [shortName, setShortName] = useState("");
  const [genBarcode, setGenBarcode] = useState<string>("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeErr, setBarcodeErr] = useState<string | null>(null);
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    // Non-admin should not land on global overview.
    if (isAdmin) return;
    const id = location?.location_id;
    if (!id) return;
    router.replace(`/location/${encodeURIComponent(id)}`);
  }, [isAdmin, location?.location_id, router]);

  if (!isAdmin && location?.location_id) {
    return (
      <main className="w-full px-4 py-8 text-center text-black">
        <p className="font-black">Weiterleitung…</p>
      </main>
    );
  }

  async function reload() {
    const [data, locs, inv, usageByLoc] = await Promise.all([
      getGlobalOverviewByProduct(),
      listLocations(),
      listInventoryAll(),
      getWeeklyUsageByLocationProduct({ days: 7 }),
    ]);
    setRows(data);

    const parents = locs.filter((l) => !l.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    setParentLocations(parents);
    const parentIds = new Set(parents.map((l) => l.id));

    const stockMap: Record<string, Record<string, number>> = {};
    for (const r of inv) {
      if (!parentIds.has(r.location_id)) continue;
      if (!stockMap[r.location_id]) stockMap[r.location_id] = {};
      stockMap[r.location_id][r.product_id] = r.quantity ?? 0;
    }
    setStockByLocationProduct(stockMap);
    setForecastByLocationProduct(usageByLoc);
  }

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        await reload();
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Überblick nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!barcodeModal || !genBarcode || !barcodeSvgRef.current) return;
    try {
      JsBarcode(barcodeSvgRef.current, genBarcode, {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 40,
        width: 1.2,
      });
    } catch {
      // ignore
    }
  }, [barcodeModal, genBarcode]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => {
      const hay = `${r.brand ?? ""} ${r.product_name ?? ""} ${r.zusatz ?? ""}`
        .trim()
        .toLowerCase();
      return hay.includes(t);
    });
  }, [rows, q]);

  const usageTotalByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      let sum = 0;
      for (const loc of parentLocations) {
        sum += Number(forecastByLocationProduct[loc.id]?.[r.id] ?? 0);
      }
      m[r.id] = Math.max(0, sum);
    }
    return m;
  }, [rows, parentLocations, forecastByLocationProduct]);

  const orderTotalByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      let sum = 0;
      for (const loc of parentLocations) {
        const stock = Number(stockByLocationProduct[loc.id]?.[r.id] ?? 0);
        const usage = Number(forecastByLocationProduct[loc.id]?.[r.id] ?? 0);
        sum += computeOrderQuantity(usage, stock);
      }
      m[r.id] = sum;
    }
    return m;
  }, [rows, parentLocations, stockByLocationProduct, forecastByLocationProduct]);

  const sortedVisible = useMemo(() => {
    const arr = [...visible];
    if (sortMode === "name") {
      arr.sort((a, b) => formatProductName(a).localeCompare(formatProductName(b)));
      return arr;
    }
    if (sortMode === "usage") {
      arr.sort(
        (a, b) =>
          (usageTotalByProduct[b.id] ?? 0) - (usageTotalByProduct[a.id] ?? 0)
      );
      return arr;
    }
    arr.sort(
      (a, b) =>
        (orderTotalByProduct[b.id] ?? 0) - (orderTotalByProduct[a.id] ?? 0)
    );
    return arr;
  }, [visible, sortMode, orderTotalByProduct, usageTotalByProduct]);

  const nameSortedVisible = useMemo(() => {
    const arr = [...visible];
    arr.sort((a, b) => formatProductName(a).localeCompare(formatProductName(b)));
    return arr;
  }, [visible]);

  const displayRows = isAdmin ? sortedVisible : nameSortedVisible;

  function openDetail(r: Row) {
    setDetailOpen({
      productId: r.id,
      title: formatProductName(r),
      total: r.quantity,
      forecastTotal: usageTotalByProduct[r.id] ?? 0,
      orderTotal: orderTotalByProduct[r.id] ?? 0,
    });
  }

  return (
    <div className="flex-1 flex flex-col">
      <main className="w-full px-4 py-4 pb-10">
        <div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Produkt suchen…"
          />
        </div>

        {!busy && rows.length > 0 && isAdmin ? (
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-black text-black/60 w-full sm:w-auto">
              Sortieren:
            </span>
            <button
              type="button"
              className={[
                "h-9 px-3 rounded-2xl border-2 border-black text-xs font-black",
                sortMode === "order" ? "bg-black text-white" : "bg-white text-black",
              ].join(" ")}
              onClick={() => setSortMode("order")}
            >
              Bestellbedarf
            </button>
            <button
              type="button"
              className={[
                "h-9 px-3 rounded-2xl border-2 border-black text-xs font-black",
                sortMode === "usage" ? "bg-black text-white" : "bg-white text-black",
              ].join(" ")}
              onClick={() => setSortMode("usage")}
            >
              Verbrauch
            </button>
            <button
              type="button"
              className={[
                "h-9 px-3 rounded-2xl border-2 border-black text-xs font-black",
                sortMode === "name" ? "bg-black text-white" : "bg-white text-black",
              ].join(" ")}
              onClick={() => setSortMode("name")}
            >
              A–Z
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        {busy ? (
          <div className="mt-6 text-black">Lade…</div>
        ) : visible.length === 0 ? (
          <div className="mt-6 text-black">Keine Produkte.</div>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayRows.map((r) => {
              const usageTotal = usageTotalByProduct[r.id] ?? 0;
              const orderTotal = orderTotalByProduct[r.id] ?? 0;
              const sig = stockSignal(r.quantity, usageTotal);
              const perf = classifyProductPerformance(usageTotal);
              const orderCrate = roundOrderToCrate(orderTotal, DEFAULT_CRATE_SIZE);
              const signalBorder =
                sig === "ok"
                  ? "border-l-emerald-600"
                  : sig === "low"
                    ? "border-l-amber-500"
                    : "border-l-red-600";
              const perfClass =
                perf === "dead"
                  ? "bg-black/10 text-black"
                  : perf === "slow"
                    ? "bg-sky-100 text-black"
                    : perf === "normal"
                      ? "bg-emerald-100 text-black"
                      : "bg-violet-200 text-black";

              if (!isAdmin) {
                return (
                  <div
                    key={r.id}
                    className="relative w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onTouchStart={(e) => {
                      const t = e.target as HTMLElement;
                      const tag = t.tagName.toLowerCase();
                      if (tag === "button" || tag === "input") return;

                      longPressFiredRef.current = false;
                      const touch = e.touches[0];
                      if (!touch) return;

                      touchStartRef.current = {
                        id: r.id,
                        x: touch.clientX,
                        y: touch.clientY,
                        moved: false,
                        scrollLock: false,
                      };

                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = setTimeout(() => {
                        longPressFiredRef.current = true;
                        setSwipeHint(null);
                        setEditError(null);
                        setEditOpen({
                          productId: r.id,
                          brand: r.brand ?? "",
                          product_name: r.product_name ?? "",
                          zusatz: (r.zusatz ?? "").trim(),
                          barcode: (r.barcode ?? "").trim(),
                          short_name: (r.short_name ?? "").trim(),
                        });
                      }, 500);
                    }}
                    onTouchMove={(e) => {
                      const touch = e.touches[0];
                      const start = touchStartRef.current;
                      if (!touch || !start || start.id !== r.id) return;
                      if (longPressFiredRef.current) return;

                      const dx = touch.clientX - start.x;
                      const dy = touch.clientY - start.y;

                      if (!start.scrollLock) {
                        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
                          start.scrollLock = true;
                          setSwipeHint(null);
                          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                          touchTimerRef.current = null;
                          return;
                        }
                        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                          start.moved = true;
                          if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                          touchTimerRef.current = null;
                        }
                      }

                      if (!start.scrollLock && dx < 0) {
                        const opacity = Math.max(0, Math.min(1, Math.abs(dx) / 80));
                        setSwipeHint({ id: r.id, opacity });
                      } else {
                        setSwipeHint(null);
                      }
                    }}
                    onTouchEnd={(e) => {
                      const t = e.target as HTMLElement;
                      const tag = t.tagName.toLowerCase();
                      if (tag === "button" || tag === "input") return;

                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = null;
                      if (longPressFiredRef.current) return;

                      const touch = e.changedTouches[0];
                      const start = touchStartRef.current;
                      touchStartRef.current = null;
                      setSwipeHint(null);
                      if (!touch || !start || start.id !== r.id) return;
                      if (start.scrollLock) return;

                      const dx = touch.clientX - start.x;
                      const dy = touch.clientY - start.y;

                      if (dx < -50 && Math.abs(dy) < 25) {
                        setSwipeFx({ id: r.id, t: Date.now() });
                        setTimeout(() => {
                          setSwipeFx((s) => (s?.id === r.id ? null : s));
                        }, 180);
                        void openDetail(r);
                        return;
                      }

                      if (start.moved) return;
                    }}
                  >
                    {swipeHint?.id === r.id ? (
                      <div
                        className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-black"
                        style={{ opacity: swipeHint.opacity * 0.25 }}
                      />
                    ) : null}
                    {swipeFx?.id === r.id ? (
                      <div className="pointer-events-none absolute right-4 top-4 text-[12px] font-black text-black/60">
                        ◀
                      </div>
                    ) : null}
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0 text-[18px] font-black leading-tight text-black">
                        {formatProductName(r)}
                      </div>
                      <div className="shrink-0 text-2xl font-black tabular-nums text-black">
                        {r.quantity}
                      </div>
                    </div>
                    <div className="mt-2 text-sm font-medium tabular-nums text-black/60">
                      7d: {usageTotal}
                    </div>
                    {!r.barcode ? (
                      <div className="mt-3">
                        <ButtonSecondary
                          className="h-12"
                          onClick={() => {
                            setBarcodeModal({
                              productId: r.id,
                              productName: formatProductName(r),
                            });
                            const existing = (r.short_name ?? "").trim();
                            setShortName(
                              existing ||
                                suggestShortName({
                                  brand: r.brand,
                                  product_name: r.product_name,
                                  zusatz: r.zusatz,
                                })
                            );
                            setGenBarcode("");
                            setBarcodeErr(null);
                          }}
                        >
                          Barcode erstellen
                        </ButtonSecondary>
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
              <div
                key={r.id}
                className={[
                  "relative w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm border-l-4",
                  signalBorder,
                ].join(" ")}
                onClick={(e) => {
                  // Tap should do nothing.
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onTouchStart={(e) => {
                  const t = e.target as HTMLElement;
                  const tag = t.tagName.toLowerCase();
                  if (tag === "button" || tag === "input") return;

                  longPressFiredRef.current = false;
                  const touch = e.touches[0];
                  if (!touch) return;

                  touchStartRef.current = {
                    id: r.id,
                    x: touch.clientX,
                    y: touch.clientY,
                    moved: false,
                    scrollLock: false,
                  };

                  if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                  touchTimerRef.current = setTimeout(() => {
                    longPressFiredRef.current = true;
                    setSwipeHint(null);
                    setEditError(null);
                    setEditOpen({
                      productId: r.id,
                      brand: r.brand ?? "",
                      product_name: r.product_name ?? "",
                      zusatz: (r.zusatz ?? "").trim(),
                      barcode: (r.barcode ?? "").trim(),
                      short_name: (r.short_name ?? "").trim(),
                    });
                  }, 500);
                }}
                onTouchMove={(e) => {
                  const touch = e.touches[0];
                  const start = touchStartRef.current;
                  if (!touch || !start || start.id !== r.id) return;
                  if (longPressFiredRef.current) return;

                  const dx = touch.clientX - start.x;
                  const dy = touch.clientY - start.y;

                  // If user is scrolling vertically, never treat as swipe.
                  if (!start.scrollLock) {
                    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
                      start.scrollLock = true;
                      setSwipeHint(null);
                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = null;
                      return;
                    }
                    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                      start.moved = true;
                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = null;
                    }
                  }

                  // Optional visual feedback while swiping left (no movement).
                  if (!start.scrollLock && dx < 0) {
                    const opacity = Math.max(0, Math.min(1, Math.abs(dx) / 80));
                    setSwipeHint({ id: r.id, opacity });
                  } else {
                    setSwipeHint(null);
                  }
                }}
                onTouchEnd={(e) => {
                  const t = e.target as HTMLElement;
                  const tag = t.tagName.toLowerCase();
                  if (tag === "button" || tag === "input") return;

                  if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                  touchTimerRef.current = null;
                  if (longPressFiredRef.current) return;

                  const touch = e.changedTouches[0];
                  const start = touchStartRef.current;
                  touchStartRef.current = null;
                  setSwipeHint(null);
                  if (!touch || !start || start.id !== r.id) return;
                  if (start.scrollLock) return;

                  const dx = touch.clientX - start.x;
                  const dy = touch.clientY - start.y;

                  // Swipe LEFT only if horizontal and strong enough.
                  if (dx < -50 && Math.abs(dy) < 25) {
                    setSwipeFx({ id: r.id, t: Date.now() });
                    setTimeout(() => {
                      setSwipeFx((s) => (s?.id === r.id ? null : s));
                    }, 180);
                    void openDetail(r);
                    return;
                  }

                  // Tap / small moves do nothing.
                }}
              >
                {swipeHint?.id === r.id ? (
                  <div
                    className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-black"
                    style={{ opacity: swipeHint.opacity * 0.25 }}
                  />
                ) : null}
                {swipeFx?.id === r.id ? (
                  <div className="pointer-events-none absolute right-4 top-4 text-[12px] font-black text-black/60">
                    ◀
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-3 min-w-0">
                    <div className="min-w-0 flex items-start gap-2">
                      <span
                        className={[
                          "mt-1.5 h-3 w-3 shrink-0 rounded-full",
                          sig === "ok"
                            ? "bg-emerald-600"
                            : sig === "low"
                              ? "bg-amber-500"
                              : "bg-red-600",
                        ].join(" ")}
                        title={
                          sig === "ok"
                            ? "Genug Bestand (≥ 7-Tage-Verbrauch)"
                            : sig === "low"
                              ? "Niedrig: Bestand unter 7-Tage-Verbrauch"
                              : "Kritisch: kein Bestand bei erwartetem Verbrauch"
                        }
                      />
                      <div className="min-w-0">
                        <div className="text-[18px] font-black truncate text-black">
                          {formatProductName(r)}
                        </div>
                        <div
                          className={[
                            "mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black",
                            perfClass,
                          ].join(" ")}
                        >
                          {performanceLabel(perf)}
                        </div>
                      </div>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div
                    className="h-10 px-3 rounded-full bg-black text-white text-[14px] font-black flex items-center"
                    title="Bestand (alle Platzerl)"
                  >
                    {r.quantity}
                  </div>
                  <div
                    className="h-10 px-3 rounded-full bg-white text-black border-2 border-black text-[14px] font-black flex items-center"
                    title="Verbrauch (7 Tage, Summe)"
                  >
                    {usageTotal}
                  </div>
                  <div
                    className={[
                      "h-10 px-3 rounded-full text-[14px] font-black flex items-center border-2",
                      orderTotal > 0
                        ? "bg-red-700 text-white border-red-800"
                        : "bg-emerald-700 text-white border-emerald-800",
                    ].join(" ")}
                    title={
                      orderTotal > 0
                        ? `Bestellung: ${orderTotal} (Kiste ${DEFAULT_CRATE_SIZE}: ${orderCrate})`
                        : "Kein Bestellbedarf (Summe)"
                    }
                  >
                    {orderTotal}
                  </div>
                </div>
                <div className="mt-2 text-[11px] font-black text-black/55">
                  Bestand · 7d · Bestellung
                  {orderTotal > 0 ? (
                    <span className="text-black">
                      {" "}
                      · Kiste {DEFAULT_CRATE_SIZE}: {orderCrate}
                    </span>
                  ) : null}
                </div>

                {!r.barcode ? (
                  <div className="mt-3">
                    <ButtonSecondary
                      className="h-12"
                      onClick={() => {
                        setBarcodeModal({
                          productId: r.id,
                          productName: formatProductName(r),
                        });
                        const existing = (r.short_name ?? "").trim();
                        setShortName(
                          existing ||
                            suggestShortName({
                              brand: r.brand,
                              product_name: r.product_name,
                              zusatz: r.zusatz,
                            })
                        );
                        setGenBarcode("");
                        setBarcodeErr(null);
                      }}
                    >
                      Barcode erstellen
                    </ButtonSecondary>
                  </div>
                ) : null}
              </div>
            );
            })}
          </div>
        )}
      </main>

      {detailOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Details</div>
                <div className="text-2xl font-black leading-tight truncate text-black">
                  {detailOpen.title}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <div
                  className="h-10 px-3 rounded-full bg-black text-white text-[14px] font-black flex items-center"
                  title="Bestand gesamt"
                >
                  {detailOpen.total}
                </div>
                <div
                  className="h-10 px-3 rounded-full bg-white text-black border-2 border-black text-[14px] font-black flex items-center"
                  title="Verbrauch 7 Tage"
                >
                  {detailOpen.forecastTotal}
                </div>
                <div
                  className={[
                    "h-10 px-3 rounded-full text-[14px] font-black flex items-center border-2",
                    detailOpen.orderTotal > 0
                      ? "bg-red-700 text-white border-red-800"
                      : "bg-emerald-700 text-white border-emerald-800",
                  ].join(" ")}
                  title="Bestellbedarf (Summe)"
                >
                  {detailOpen.orderTotal}
                </div>
                <button
                  className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
                  onClick={() => setDetailOpen(null)}
                >
                  Schließen
                </button>
              </div>
              <button
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>

            <div className="mt-2 text-[11px] font-black text-black/55">
              Bestand · 7d · Bestellung
            </div>

            <div className="mt-4 grid gap-2">
              {parentLocations.map((loc) => {
                const stock = Number(
                  stockByLocationProduct[loc.id]?.[detailOpen.productId] ?? 0
                );
                const forecast = Number(
                  forecastByLocationProduct[loc.id]?.[detailOpen.productId] ?? 0
                );
                const orderLoc = computeOrderQuantity(forecast, stock);
                const orderCrateLoc = roundOrderToCrate(orderLoc, DEFAULT_CRATE_SIZE);
                return (
                  <div
                    key={loc.id}
                    className="w-full rounded-3xl border-2 border-black bg-white px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 font-black text-black truncate">
                      {loc.name}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div
                        className="h-10 px-3 rounded-full bg-black text-white text-[14px] font-black flex items-center"
                        title="Bestand"
                      >
                        {stock}
                      </div>
                      <div
                        className="h-10 px-3 rounded-full bg-white text-black border-2 border-black text-[14px] font-black flex items-center"
                        title="Verbrauch 7 Tage"
                      >
                        {forecast}
                      </div>
                      <div
                        className={[
                          "h-10 px-3 rounded-full text-[14px] font-black flex items-center border-2",
                          orderLoc > 0
                            ? "bg-red-700 text-white border-red-800"
                            : "bg-emerald-700 text-white border-emerald-800",
                        ].join(" ")}
                        title={
                          orderLoc > 0
                            ? `Bestellung ${orderLoc} (Kiste ${DEFAULT_CRATE_SIZE}: ${orderCrateLoc})`
                            : "Kein Bestellbedarf"
                        }
                      >
                        {orderLoc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Produkt bearbeiten</div>
                <div className="text-2xl font-black leading-tight truncate text-black">
                  {editOpen.brand} - {editOpen.product_name}
                </div>
              </div>
              <button
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
                onClick={() => setEditOpen(null)}
              >
                Schließen
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <div className="text-sm font-black text-black">Brand</div>
                <Input
                  value={editOpen.brand}
                  onChange={(e) =>
                    setEditOpen((s) => (s ? { ...s, brand: e.target.value } : s))
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <div className="text-sm font-black text-black">Produkt</div>
                <Input
                  value={editOpen.product_name}
                  onChange={(e) =>
                    setEditOpen((s) =>
                      s ? { ...s, product_name: e.target.value } : s
                    )
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <div className="text-sm font-black text-black">Zusatz</div>
                <Input
                  value={editOpen.zusatz}
                  onChange={(e) =>
                    setEditOpen((s) => (s ? { ...s, zusatz: e.target.value } : s))
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <div className="text-sm font-black text-black">Barcode</div>
                <Input
                  value={editOpen.barcode}
                  onChange={(e) =>
                    setEditOpen((s) => (s ? { ...s, barcode: e.target.value } : s))
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <div className="text-sm font-black text-black">Kurzname</div>
                <Input
                  value={editOpen.short_name}
                  onChange={(e) =>
                    setEditOpen((s) =>
                      s ? { ...s, short_name: e.target.value } : s
                    )
                  }
                  className="mt-2"
                />
              </div>

              <ButtonSecondary
                className="h-12"
                onClick={() => {
                  const sug = suggestShortName({
                    brand: editOpen.brand,
                    product_name: editOpen.product_name,
                    zusatz: editOpen.zusatz,
                  });
                  setEditOpen((s) => (s ? { ...s, short_name: sug } : s));
                }}
              >
                Kurzname vorschlagen
              </ButtonSecondary>

              {editError ? (
                <div className="rounded-3xl bg-red-50 p-4 text-red-800">
                  {editError}
                </div>
              ) : null}

              <Button
                className="h-14 text-lg"
                disabled={editBusy || !editOpen.brand.trim() || !editOpen.product_name.trim()}
                onClick={async () => {
                  if (!editOpen) return;
                  setEditBusy(true);
                  setEditError(null);
                  try {
                    await updateProduct({
                      productId: editOpen.productId,
                      brand: editOpen.brand,
                      product_name: editOpen.product_name,
                      zusatz: editOpen.zusatz.trim() ? editOpen.zusatz.trim() : null,
                      barcode: editOpen.barcode.trim() ? editOpen.barcode.trim() : null,
                      short_name: editOpen.short_name.trim()
                        ? editOpen.short_name.trim()
                        : null,
                    });
                    await reload();
                    setEditOpen(null);
                  } catch (e: unknown) {
                    setEditError(errorMessage(e, "Konnte Produkt nicht speichern."));
                  } finally {
                    setEditBusy(false);
                  }
                }}
              >
                {editBusy ? "Speichert…" : "Speichern"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {barcodeModal ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Barcode Label</div>
                <div className="text-2xl font-black leading-tight truncate text-black">
                  {barcodeModal.productName}
                </div>
              </div>
              <button
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
                onClick={() => setBarcodeModal(null)}
              >
                Schließen
              </button>
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-black">Kurzname (Label)</div>
              <Input
                value={shortName}
                onChange={(ev) => setShortName(ev.target.value)}
                placeholder='z.B. "co 0,5"'
                className="mt-2"
              />
            </div>

            <div className="mt-4 rounded-3xl border-2 border-black bg-white p-4">
              <div className="text-sm font-black text-black">
                Vorschau (3cm × 1,5cm)
              </div>
              <div className="mt-3 flex justify-center">
                <div
                  style={{
                    width: "3cm",
                    height: "1.5cm",
                    border: "1px solid rgba(0,0,0,0.1)",
                    borderRadius: "6mm",
                    padding: "2mm",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: "1mm",
                  }}
                >
                  <svg ref={barcodeSvgRef} />
                  <div
                    style={{
                      fontSize: "7pt",
                      fontWeight: 900,
                      textAlign: "center",
                      color: "#000000",
                      lineHeight: 1.1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={shortName}
                  >
                    {shortName || " "}
                  </div>
                </div>
              </div>
              {genBarcode ? (
                <div className="mt-2 text-center text-xs font-mono text-black">
                  {genBarcode}
                </div>
              ) : null}
            </div>

            {barcodeErr ? (
              <div className="mt-3 rounded-3xl bg-red-50 p-4 text-red-800">
                {barcodeErr}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <ButtonSecondary
                className="h-14 text-lg"
                onClick={() => {
                  const base = Date.now().toString(10).slice(-8);
                  const rand = Math.floor(Math.random() * 9000 + 1000).toString(10);
                  setGenBarcode(`PENZI${base}${rand}`);
                }}
              >
                Barcode generieren
              </ButtonSecondary>

              <Button
                className="h-14 text-lg"
                disabled={barcodeBusy || !genBarcode || !shortName.trim()}
                onClick={async () => {
                  setBarcodeErr(null);
                  setBarcodeBusy(true);
                  try {
                      await updateProductBarcode({
                        productId: barcodeModal.productId,
                        barcode: genBarcode,
                        short_name: shortName.trim(),
                      });
                    await reload();
                    setBarcodeModal(null);
                  } catch (e: unknown) {
                    setBarcodeErr(errorMessage(e, "Konnte Barcode nicht speichern."));
                  } finally {
                    setBarcodeBusy(false);
                  }
                }}
              >
                {barcodeBusy ? "Speichert…" : "Speichern"}
              </Button>

              <ButtonSecondary
                className="h-14 text-lg"
                disabled={!genBarcode || !shortName.trim()}
                onClick={() => {
                  const svg = barcodeSvgRef.current;
                  if (!svg) return;
                  const svgMarkup = svg.outerHTML;
                  const text = shortName.trim();

                  const win = window.open("", "_blank", "noopener,noreferrer");
                  if (!win) return;
                  win.document.open();
                  win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Barcode Label</title>
  <style>
    @page { margin: 8mm; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .label {
      width: 3cm;
      height: 1.5cm;
      border: 2px solid #000;
      border-radius: 6mm;
      padding: 2mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1mm;
    }
    .name { font-size: 7pt; font-weight: 900; text-align: center; color: #000; line-height: 1.1; }
    svg { width: 100%; height: 40px; }
  </style>
</head>
<body>
  <div class="label">
    ${svgMarkup}
    <div class="name">${escapeHtml(text)}</div>
  </div>
  <script>
    window.onload = () => { window.print(); };
  </script>
</body>
</html>`);
                  win.document.close();
                }}
              >
                Drucken
              </ButtonSecondary>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

