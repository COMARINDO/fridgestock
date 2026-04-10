"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
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
  const router = useRouter();
  const { logout } = useAuth();
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

  const [detailOpen, setDetailOpen] = useState<{
    productId: string;
    title: string;
    total: number;
    forecastTotal: number;
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

  function forecastTotalForProduct(productId: string): number {
    let sum = 0;
    for (const loc of parentLocations) {
      sum += Number(forecastByLocationProduct[loc.id]?.[productId] ?? 0);
    }
    return Math.max(0, sum);
  }

  function openDetail(r: Row) {
    setDetailOpen({
      productId: r.id,
      title: formatProductName(r),
      total: r.quantity,
      forecastTotal: forecastTotalForProduct(r.id),
    });
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 border-b-2 border-black bg-[var(--background)]">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Image src="/logo.png" alt="Bstand" width={36} height={36} />
              <div className="min-w-0">
                <div className="text-[13px] text-black">Global</div>
                <div className="text-xl font-black leading-tight text-black">Überblick</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-[15px] font-black text-black">
                Home
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
                className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
              >
                Abmelden
              </button>
            </div>
          </div>

          <div className="mt-4">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Produkt suchen…"
              autoFocus
            />
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-4 pb-10">
        {error ? (
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        {busy ? (
          <div className="mt-6 text-black">Lade…</div>
        ) : visible.length === 0 ? (
          <div className="mt-6 text-black">Keine Produkte.</div>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visible.map((r) => (
              <div
                key={r.id}
                className="relative w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm"
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
                  <div className="min-w-0">
                    <div className="text-[18px] font-black truncate text-black">
                      {formatProductName(r)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-10 px-4 rounded-full bg-black text-white text-[16px] font-black flex items-center">
                      {r.quantity}
                    </div>
                    {(() => {
                      const forecast = forecastTotalForProduct(r.id);
                      const enough = r.quantity >= forecast;
                      return (
                        <div
                          className={[
                            "h-10 px-4 rounded-full text-white text-[16px] font-black flex items-center",
                            enough ? "bg-emerald-700" : "bg-red-700",
                          ].join(" ")}
                          title="Forecast (7 Tage)"
                        >
                          {forecast}
                        </div>
                      );
                    })()}
                  </div>
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
            ))}
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
              <div className="flex items-center gap-2">
                <div className="h-10 px-4 rounded-full bg-black text-white text-[16px] font-black flex items-center">
                  {detailOpen.total}
                </div>
                <div
                  className={[
                    "h-10 px-4 rounded-full text-white text-[16px] font-black flex items-center",
                    detailOpen.total >= detailOpen.forecastTotal
                      ? "bg-emerald-700"
                      : "bg-red-700",
                  ].join(" ")}
                >
                  {detailOpen.forecastTotal}
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

            <div className="mt-4 grid gap-2">
              {parentLocations.map((loc) => {
                const stock = Number(
                  stockByLocationProduct[loc.id]?.[detailOpen.productId] ?? 0
                );
                const forecast = Number(
                  forecastByLocationProduct[loc.id]?.[detailOpen.productId] ?? 0
                );
                const enough = stock >= forecast;
                return (
                  <div
                    key={loc.id}
                    className="w-full rounded-3xl border-2 border-black bg-white px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 font-black text-black truncate">
                      {loc.name}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-10 px-4 rounded-full bg-black text-white text-[16px] font-black flex items-center">
                        {stock}
                      </div>
                      <div
                        className={[
                          "h-10 px-4 rounded-full text-white text-[16px] font-black flex items-center",
                          enough ? "bg-emerald-700" : "bg-red-700",
                        ].join(" ")}
                      >
                        {forecast}
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

