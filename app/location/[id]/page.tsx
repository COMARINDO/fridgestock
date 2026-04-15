"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
import { useAuth } from "@/app/providers";
import {
  getProductByBarcode,
  listProductsWithInventoryForLocation,
  createProductWithBarcode,
  applyInventoryDelta,
  setInventoryQuantity,
  getLastUpdateByLocation,
  getInventoryHistoryForProduct,
  deleteInventoryHistoryEntry,
} from "@/lib/db";
import type { InventoryHistoryRow, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { suggestShortName } from "@/lib/shortName";
import { splitNameToBrandProduct } from "@/lib/brandProduct";
import { formatProductName } from "@/lib/formatProductName";
import { useAdmin } from "@/app/admin-provider";

function formatHistoryTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function LocationPage() {
  return (
    <RequireAuth>
      <LocationInner />
    </RequireAuth>
  );
}

function LocationInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const locationId = params?.id ?? "";
  const { location: sessionLocation } = useAuth();
  const { isAdmin } = useAdmin();

  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [lastUpdateByProduct, setLastUpdateByProduct] = useState<Record<string, string>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scanSheet, setScanSheet] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  const [scanMode, setScanMode] = useState<"choose" | "set" | "add">("choose");
  const [setQty, setSetQty] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [inlineAddDraft, setInlineAddDraft] = useState("1");
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [newProductBrand, setNewProductBrand] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductZusatz, setNewProductZusatz] = useState("");
  const [newProductShortName, setNewProductShortName] = useState("");
  const [newShortTouched, setNewShortTouched] = useState(false);
  const [offLoading, setOffLoading] = useState(false);
  const [offSuggestion, setOffSuggestion] = useState<string | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  // Barcode creation moved to /overview (global).

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingQty = useRef<Record<string, number>>({});
  const quantitiesRef = useRef<Record<string, number>>({});
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const touchScrollRef = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const qtyInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [quickEdit, setQuickEdit] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  const [quickHistoryRows, setQuickHistoryRows] = useState<InventoryHistoryRow[]>([]);
  const [quickHistoryLoading, setQuickHistoryLoading] = useState(false);
  const [historyDeleteId, setHistoryDeleteId] = useState<string | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  const [refillToast, setRefillToast] = useState<string | null>(null);

  useEffect(() => {
    quantitiesRef.current = quantities;
  }, [quantities]);

  useEffect(() => {
    if (!locationId) {
      router.replace("/");
      return;
    }

    (async () => {
      setError(null);
      try {
        const rows = await listProductsWithInventoryForLocation(locationId);

        setProducts(rows);

        const q: Record<string, number> = {};
        for (const p of rows) q[p.id] = p.quantity ?? 0;
        setQuantities(q);

        try {
          setLastUpdateByProduct(await getLastUpdateByLocation(locationId));
        } catch {
          // ignore
        }
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Daten nicht laden."));
      }
    })();
  }, [locationId, router]);

  useEffect(() => {
    if (!quickEdit || !locationId) {
      setQuickHistoryRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setHistoryErr(null);
      setQuickHistoryLoading(true);
      try {
        const rows = await getInventoryHistoryForProduct(
          locationId,
          quickEdit.productId,
          5
        );
        if (!cancelled) setQuickHistoryRows(rows);
      } catch (e: unknown) {
        if (!cancelled) {
          setHistoryErr(errorMessage(e, "Konnte Verlauf nicht laden."));
        }
      } finally {
        if (!cancelled) setQuickHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quickEdit, locationId]);

  const canWrite = useMemo(() => {
    const assigned = sessionLocation?.location_id;
    if (!assigned || !locationId) return false;
    return assigned === locationId;
  }, [sessionLocation?.location_id, locationId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("fridge.scanMode.v1");
      if (raw === "set" || raw === "add") setScanMode(raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      try {
        const raw = window.localStorage.getItem("fridge.scanMode.v1");
        if (raw === "set" || raw === "add") setScanMode(raw);
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", sync);
    window.addEventListener("fridge-scanmode", sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("fridge-scanmode", sync as EventListener);
    };
  }, []);

  useEffect(() => {
    if (scanMode !== "set" && scanMode !== "add") return;
    try {
      window.localStorage.setItem("fridge.scanMode.v1", scanMode);
    } catch {
      // ignore
    }
  }, [scanMode]);

  async function runSave(productId: string) {
    if (!locationId) return;
    if (!canWrite) return;
    const nextQty = pendingQty.current[productId];
    if (nextQty === undefined) return;

    try {
      if (scanMode === "add") {
        const prev = quantitiesRef.current[productId] ?? 0;
        const delta = Math.max(0, nextQty - prev);
        if (delta > 0) {
          const { newQuantity } = await applyInventoryDelta({
            locationId,
            productId,
            delta,
          });
          quantitiesRef.current = { ...quantitiesRef.current, [productId]: newQuantity };
          setQuantities((m) => ({ ...m, [productId]: newQuantity }));
        }
      } else {
        await setInventoryQuantity({
          locationId,
          productId,
          quantity: nextQty,
        });
      }
    } catch {
      // ignore
    }
  }

  function scheduleSave(productId: string, nextQty: number) {
    if (!canWrite) return;
    pendingQty.current[productId] = nextQty;

    if (timers.current[productId]) clearTimeout(timers.current[productId]);

    timers.current[productId] = setTimeout(async () => {
      await runSave(productId);
    }, 200); // ~200ms debounce
  }

  /**
   * Positives Delta: an anderen Platzerl wie bisher;
   * am Teich und in der Rabenstein Filiale atomar vom Rabenstein Lager.
   */
  async function addPositiveDelta(productId: string, delta: number): Promise<boolean> {
    if (!locationId || !canWrite) {
      setError("Keine Schreibrechte für dieses Platzerl.");
      return false;
    }
    const d = Math.floor(Number(delta));
    if (!Number.isFinite(d) || d <= 0) {
      setError("Bitte eine Zahl größer als 0 eingeben.");
      return false;
    }

    try {
      const { newQuantity } = await applyInventoryDelta({
        locationId,
        productId,
        delta: d,
      });
      quantitiesRef.current = { ...quantitiesRef.current, [productId]: newQuantity };
      setQuantities((m) => ({ ...m, [productId]: newQuantity }));
    } catch (e: unknown) {
      setError(errorMessage(e, "Auffüllen fehlgeschlagen."));
      return false;
    }
    setRefillToast(`+${d} gebucht`);
    window.setTimeout(() => setRefillToast(null), 2500);
    return true;
  }

  async function deleteHistoryRow(row: InventoryHistoryRow) {
    if (!locationId || !canWrite) return;
    setHistoryDeleteId(row.id);
    setHistoryErr(null);
    try {
      const { newQuantity } = await deleteInventoryHistoryEntry({
        id: row.id,
        locationId,
        productId: row.product_id,
      });
      quantitiesRef.current = {
        ...quantitiesRef.current,
        [row.product_id]: newQuantity,
      };
      setQuantities((m) => ({ ...m, [row.product_id]: newQuantity }));
      const rows = await getInventoryHistoryForProduct(
        locationId,
        row.product_id,
        5
      );
      setQuickHistoryRows(rows);
      setLastUpdateByProduct(await getLastUpdateByLocation(locationId));
    } catch (e: unknown) {
      setHistoryErr(errorMessage(e, "Eintrag konnte nicht gelöscht werden."));
    } finally {
      setHistoryDeleteId(null);
    }
  }

  function focusQtyInput(productId: string) {
    setTimeout(() => {
      const el = qtyInputs.current[productId];
      el?.focus();
      el?.select?.();
    }, 0);
  }

  /** Nach setEditingId: Input ist erst nach Render im DOM. */
  function openQtyEditor(productId: string) {
    if (!canWrite) return;
    setEditingId(productId);
    setTimeout(() => {
      const el = qtyInputs.current[productId];
      el?.focus();
      el?.select?.();
    }, 50);
  }

  const handleBarcode = useCallback(
    async (codeRaw: string) => {
      if (!canWrite) return;
      const code = codeRaw.trim();
      if (!code) return;
      setScanError(null);

      try {
        // Ignore duplicate scans within short time.
        const now = Date.now();
        if (lastScanRef.current.code === code && now - lastScanRef.current.at < 900)
          return;
        lastScanRef.current = { code, at: now };

        const p = await getProductByBarcode(code);
        if (!p) {
          setUnknownBarcode(code);
          setNewProductBrand("");
          setNewProductName("");
          setNewProductZusatz("");
          setNewProductShortName("");
          setNewShortTouched(false);
          setOffSuggestion(null);
          setOffError(null);
          return;
        }

        setHighlightId(p.id);
        setTimeout(() => setHighlightId(null), 2500);

        setTimeout(() => {
          rowRefs.current[p.id]?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        }, 60);

        // No automatic quantity changes on scan.
        // Tap/hold on the product card handles +1 / menu.
        setScanSheet(null);
        setScanMode("choose");
        setSetQty(String(quantitiesRef.current[p.id] ?? 0));
        setAddQty("1");
      } catch (e: unknown) {
        setScanError(errorMessage(e, "Barcode konnte nicht geprüft werden."));
      }
    },
    [canWrite]
  );

  useEffect(() => {
    if (!unknownBarcode) return;
    let cancelled = false;

    (async () => {
      setOffLoading(true);
      setOffError(null);
      setOffSuggestion(null);
      try {
        const code = unknownBarcode.trim();
        // Open Food Facts v0 endpoint (simple + fast)
        const res = await fetch(
          `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`
        );
        if (!res.ok) throw new Error("Open Food Facts nicht erreichbar.");
        const json: unknown = await res.json();
        const j = json as { status?: unknown; product?: { product_name?: unknown } };

        const ok = j.status === 1;
        const name =
          ok && typeof j.product?.product_name === "string" ? j.product.product_name : null;
        if (cancelled) return;
        if (typeof name === "string" && name.trim()) {
          const clean = name.trim();
          setOffSuggestion(clean);
          // Pre-fill if user hasn't typed yet
          const split = splitNameToBrandProduct(clean);
          setNewProductBrand((cur) => (cur.trim() ? cur : split.brand));
          setNewProductName((cur) =>
            cur.trim() ? cur : (split.product_name || clean)
          );
        } else {
          setOffError("Kein Vorschlag gefunden.");
        }
      } catch {
        if (cancelled) return;
        setOffError("Kein Vorschlag gefunden.");
      } finally {
        if (!cancelled) setOffLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unknownBarcode]);

  useEffect(() => {
    if (!unknownBarcode) return;
    if (newShortTouched) return;
    const sug = suggestShortName({
      brand: newProductBrand,
      product_name: newProductName,
      zusatz: newProductZusatz,
    });
    setNewProductShortName(sug);
  }, [unknownBarcode, newProductBrand, newProductName, newProductZusatz, newShortTouched]);

  // (barcode generation UI removed here)

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    let stopFn: null | (() => void) = null;

    (async () => {
      setScanError(null);
      try {
        const video = scannerVideoRef.current;
        if (!video) throw new Error("Video element fehlt.");

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
        ]);

        // Lower delay between attempts for faster detection.
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 40,
          delayBetweenScanSuccess: 250,
        });

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        const controls = await reader.decodeFromConstraints(
          constraints,
          video,
          async (result, err) => {
            if (cancelled) return;
            if (result) {
              try {
                navigator.vibrate?.(40);
              } catch {}
              setScannerOpen(false);
              try {
                controls.stop();
              } catch {
                // ignore
              }
              await handleBarcode(result.getText());
              return;
            }

            // NotFoundException is expected while scanning; ignore.
            if (err && !(err instanceof NotFoundException)) {
              setScanError("Scan fehlgeschlagen. Bitte Barcode näher halten.");
            }
          }
        );

        stopFn = () => {
          try {
            controls.stop();
          } catch {
            // ignore
          }
        };
      } catch (e: unknown) {
        setScanError(errorMessage(e, "Scanner konnte nicht gestartet werden."));
      }
    })();

    return () => {
      cancelled = true;
      stopFn?.();
    };
  }, [scannerOpen, canWrite, handleBarcode]);

  const visibleProducts = useMemo(() => {
    const arr = [...products];
    const label = (p: Product) => formatProductName(p).toLowerCase();
    arr.sort((a, b) => label(a).localeCompare(label(b)));
    return arr;
  }, [products]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <main className="w-full px-4 py-6">
          <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <main className="w-full px-4 pt-2 pb-28">
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleProducts.map((p) => {
                const qty = quantities[p.id] ?? 0;

                return (
                  <div
                    key={p.id}
                    className={[
                      "w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm",
                      highlightId === p.id ? "ring-2 ring-emerald-500" : "",
                    ].join(" ")}
                    onClick={(e) => {
                      // Click-to-focus quantity input (fast)
                      if ((e.target as HTMLElement).tagName.toLowerCase() === "button") return;
                      if ((e.target as HTMLElement).tagName.toLowerCase() === "input") return;
                      qtyInputs.current[p.id]?.focus();
                    }}
                    onTouchStart={(e) => {
                      const t = e.target as HTMLElement;
                      const tag = t.tagName.toLowerCase();
                      if (tag === "button" || tag === "input") return;
                      const touch = e.touches[0];
                      if (!touch) return;
                      touchScrollRef.current = {
                        id: p.id,
                        x: touch.clientX,
                        y: touch.clientY,
                        moved: false,
                      };
                      longPressFiredRef.current = false;
                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = setTimeout(() => {
                        longPressFiredRef.current = true;
                        setEditingId(p.id);
                        focusQtyInput(p.id);
                      }, 500);
                    }}
                    onTouchMove={(e) => {
                      const touch = e.touches[0];
                      const s = touchScrollRef.current;
                      if (!touch || !s || s.id !== p.id) return;
                      const dx = touch.clientX - s.x;
                      const dy = touch.clientY - s.y;
                      if (Math.hypot(dx, dy) > 10) {
                        s.moved = true;
                        if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                        touchTimerRef.current = null;
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
                      const s = touchScrollRef.current;
                      touchScrollRef.current = null;
                      if (touch && s?.id === p.id) {
                        const dx = touch.clientX - s.x;
                        const dy = touch.clientY - s.y;
                        // Nach rechts wischen: Schnellbearbeitung (absolute Menge).
                        if (dx > 50 && Math.abs(dy) < 25) {
                          setHistoryErr(null);
                          setQuickEdit({
                            productId: p.id,
                            productName: formatProductName(p),
                          });
                          return;
                        }
                        // Scrolling/movement cancels tap actions.
                        if (s.moved) return;
                      }

                      // Simple tap: just focus the quantity editor (no implicit booking).
                      if (canWrite) openQtyEditor(p.id);
                    }}
                    ref={(el) => {
                      rowRefs.current[p.id] = el;
                    }}
                  >
                    <div className="text-center">
                      <div className="text-lg font-black text-black">
                        {formatProductName(p)}
                      </div>
                  {isAdmin
                    ? (() => {
                        const ts = lastUpdateByProduct[p.id];
                        if (!ts) return null;
                        const ageMs = Date.now() - Date.parse(ts);
                        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
                        const hours = Math.floor(ageMs / (60 * 60 * 1000));
                        const label =
                          days >= 1
                            ? `Update: vor ${days} Tagen`
                            : `Update: vor ${hours} Std.`;
                        const stale = ageMs > 3 * 24 * 60 * 60 * 1000;
                        return (
                          <div
                            className={[
                              "mt-1 text-[13px] font-black",
                              stale ? "text-orange-700" : "text-black/60",
                            ].join(" ")}
                          >
                            {label}
                          </div>
                        );
                      })()
                    : null}
                    </div>

                    <div className="mt-4 flex items-center justify-center gap-3 min-w-0">
                      {editingId === p.id ? (
                        scanMode === "add" ? (
                          <div className="flex flex-1 min-w-0 items-center gap-2">
                            <input
                              inputMode="numeric"
                              type="tel"
                              pattern="[0-9]*"
                              enterKeyHint="done"
                              value={inlineAddDraft}
                              onChange={(e) => {
                                setInlineAddDraft(e.target.value.replace(/[^\d]/g, ""));
                              }}
                              onFocus={(e) => e.currentTarget.select()}
                              ref={(el) => {
                                qtyInputs.current[p.id] = el;
                              }}
                              className="h-14 flex-1 min-w-0 rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black outline-none focus:ring-2 focus:ring-black/20"
                              aria-label="Auffüllen (+X)"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="h-14 px-4 rounded-2xl bg-emerald-700 text-white text-sm font-black active:scale-[0.99]"
                              disabled={!canWrite}
                              onClick={() => {
                                void (async () => {
                                  const n = Number(inlineAddDraft || "0");
                                  const d = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
                                  if (!d) {
                                    setError("Bitte eine Zahl größer als 0 eingeben.");
                                    return;
                                  }
                                  const ok = await addPositiveDelta(p.id, d);
                                  if (ok) {
                                    setInlineAddDraft("1");
                                    setEditingId(null);
                                    qtyInputs.current[p.id]?.focus();
                                  }
                                })();
                              }}
                            >
                              + buchen
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-1 min-w-0 items-center gap-2">
                            <input
                              inputMode="numeric"
                              type="tel"
                              pattern="[0-9]*"
                              enterKeyHint="done"
                              value={String(qty)}
                              onChange={(e) => {
                                const v = Number(e.target.value.replace(/[^\d]/g, ""));
                                const next = Number.isFinite(v) ? v : 0;
                                quantitiesRef.current = { ...quantitiesRef.current, [p.id]: next };
                                setQuantities((m) => ({ ...m, [p.id]: next }));
                              }}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={() => {
                                setEditingId((cur) => (cur === p.id ? null : cur));
                              }}
                              ref={(el) => {
                                qtyInputs.current[p.id] = el;
                              }}
                              className="h-14 flex-1 min-w-0 rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black outline-none focus:ring-2 focus:ring-black/20"
                              aria-label="Inventur (absolut)"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="h-14 px-4 rounded-2xl bg-blue-700 text-white text-sm font-black active:scale-[0.99]"
                              onMouseDown={(e) => {
                                // Prevent input blur from unmounting the button before click fires.
                                e.preventDefault();
                              }}
                              onTouchStart={(e) => {
                                e.preventDefault();
                              }}
                              onClick={() => {
                                void (async () => {
                                  if (!locationId || !canWrite) return;
                                  const next = quantitiesRef.current[p.id] ?? 0;
                                  try {
                                    await setInventoryQuantity({
                                      locationId,
                                      productId: p.id,
                                      quantity: next,
                                    });
                                    try {
                                      setLastUpdateByProduct(await getLastUpdateByLocation(locationId));
                                    } catch {
                                      // ignore
                                    }
                                    setRefillToast(`Inventur: ${next}`);
                                    window.setTimeout(() => setRefillToast(null), 2000);
                                    setEditingId(null);
                                  } catch (e: unknown) {
                                    setError(errorMessage(e, "Inventur fehlgeschlagen."));
                                  }
                                })();
                              }}
                            >
                              Inventur
                            </button>
                          </div>
                        )
                      ) : (
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (scanMode === "add") setInlineAddDraft("1");
                            openQtyEditor(p.id);
                          }}
                          className={[
                            "h-14 flex-1 min-w-0 rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black flex items-center justify-center select-none",
                            canWrite
                              ? "cursor-pointer active:bg-black/5"
                              : "cursor-default opacity-80",
                          ].join(" ")}
                          aria-label="Menge tippen zum Ändern"
                        >
                          {qty}
                        </button>
                      )}
                    </div>
                  </div>
                );
          })}
        </div>

        <div className="mt-6">
          <ButtonSecondary className="" onClick={() => router.replace("/")}>
            Zurück zu Platzerl
          </ButtonSecondary>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t-2 border-black bg-[var(--background)]">
        <div className="w-full px-4 py-3 flex gap-2">
          <Button
            className="h-14 text-lg"
            onClick={() => setScannerOpen(true)}
            disabled={!canWrite}
          >
            SCAN PRODUKT
          </Button>
        </div>
      </div>

      {scannerOpen ? (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-white border-b-2 border-black">
            <div className="font-black text-black">Barcode Scan</div>
            <button
              className="h-10 px-3 rounded-xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
              onClick={() => setScannerOpen(false)}
            >
              Schließen
            </button>
          </div>
          <div className="absolute inset-0 top-16">
            <video
              ref={scannerVideoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />

            {/* simple scan frame */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[84vw] max-w-[520px] h-[22vh] max-h-[220px] rounded-3xl border-2 border-white/70 bg-white/5" />
            </div>
          </div>
          {scanError ? (
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white p-4 text-black border-2 border-black">
              {scanError}
            </div>
          ) : null}
        </div>
      ) : null}

      {unknownBarcode ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="text-lg font-black text-black">Produkt nicht gefunden</div>
              <div className="mt-1 text-sm text-black font-mono">
              {unknownBarcode}
            </div>

            <div className="mt-3 rounded-2xl border-2 border-black bg-white p-4">
              <div className="text-sm font-black text-black">
                Vorschlag (Open Food Facts)
              </div>
              {offLoading ? (
                <div className="mt-1 text-sm text-black">Suche…</div>
              ) : offSuggestion ? (
                <div className="mt-2">
                  <div className="text-sm font-black text-black">
                    {offSuggestion}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      className="h-12"
                      onClick={async () => {
                        if (!canWrite) return;
                        if (!unknownBarcode) return;
                        try {
                          await createProductWithBarcode({
                            brand: newProductBrand.trim() ? newProductBrand.trim() : null,
                            product_name: newProductName.trim() ? newProductName.trim() : null,
                            zusatz: newProductZusatz.trim()
                              ? newProductZusatz.trim()
                              : null,
                            short_name: newProductShortName.trim()
                              ? newProductShortName.trim()
                              : null,
                            barcode: unknownBarcode,
                          });
                          const prods = await listProductsWithInventoryForLocation(
                            locationId
                          );
                          setProducts(prods);
                          setQuantities((prev) => {
                            const next = { ...prev };
                            for (const p of prods)
                              if (next[p.id] === undefined) next[p.id] = 0;
                            return next;
                          });
                          const created = prods.find(
                            (p) => p.barcode === unknownBarcode
                          );
                          setUnknownBarcode(null);
                          setNewProductBrand("");
                          setNewProductName("");
                          setNewProductZusatz("");
                          setNewProductShortName("");
                          setNewShortTouched(false);
                          if (created) {
                            setHighlightId(created.id);
                            setTimeout(() => {
                              rowRefs.current[created.id]?.scrollIntoView({
                                block: "center",
                                behavior: "smooth",
                              });
                              qtyInputs.current[created.id]?.focus();
                            }, 80);
                            setTimeout(() => setHighlightId(null), 1400);
                          }
                        } catch (e: unknown) {
                          setScanError(
                            errorMessage(e, "Produkt konnte nicht erstellt werden.")
                          );
                        }
                      }}
                    >
                      Speichern
                    </Button>
                    <ButtonSecondary
                      className="h-12"
                      onClick={() => {
                        setUnknownBarcode(null);
                        setNewProductBrand("");
                        setNewProductName("");
                        setNewProductZusatz("");
                        setNewProductShortName("");
                        setNewShortTouched(false);
                      }}
                    >
                      Abbrechen
                    </ButtonSecondary>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-sm text-black">
                  {offError ?? "Kein Vorschlag."}
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-black">Brand</div>
              <Input
                value={newProductBrand}
                onChange={(ev) => setNewProductBrand(ev.target.value)}
                placeholder='z.B. "Red Bull"'
                autoFocus
              />
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-black">Produkt</div>
              <Input
                value={newProductName}
                onChange={(ev) => setNewProductName(ev.target.value)}
                placeholder='z.B. "Zero"'
              />
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-black">Zusatz</div>
              <Input
                value={newProductZusatz}
                onChange={(ev) => setNewProductZusatz(ev.target.value)}
                placeholder='z.B. "0,5l", "1l", "Dose"'
                className="mt-2"
              />
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-black">Kurzname (Label)</div>
              <Input
                value={newProductShortName}
                onChange={(ev) => {
                  setNewShortTouched(true);
                  setNewProductShortName(ev.target.value);
                }}
                placeholder='z.B. "co 0,5"'
                className="mt-2"
              />
            </div>

            {!offSuggestion && !offLoading ? (
              <div className="mt-4 grid gap-2">
              <Button
                className="w-full h-14 text-lg"
                disabled={!newProductName.trim()}
                onClick={async () => {
                    if (!canWrite) return;
                  if (!unknownBarcode) return;
                  try {
                    await createProductWithBarcode({
                      brand: newProductBrand.trim() ? newProductBrand.trim() : null,
                      product_name: newProductName.trim() ? newProductName.trim() : null,
                      zusatz: newProductZusatz.trim() ? newProductZusatz.trim() : null,
                      short_name: newProductShortName.trim()
                        ? newProductShortName.trim()
                        : null,
                      barcode: unknownBarcode,
                    });
                    const prods = await listProductsWithInventoryForLocation(
                      locationId
                    );
                    setProducts(prods);
                    setQuantities((prev) => {
                      const next = { ...prev };
                      for (const p of prods) if (next[p.id] === undefined) next[p.id] = 0;
                      return next;
                    });
                    const created = prods.find((p) => p.barcode === unknownBarcode);
                    setUnknownBarcode(null);
                    setNewProductBrand("");
                    setNewProductName("");
                    setNewProductZusatz("");
                    setNewProductShortName("");
                    setNewShortTouched(false);
                    if (created) {
                      setHighlightId(created.id);
                      setTimeout(() => {
                        rowRefs.current[created.id]?.scrollIntoView({
                          block: "center",
                          behavior: "smooth",
                        });
                        qtyInputs.current[created.id]?.focus();
                      }, 80);
                      setTimeout(() => setHighlightId(null), 1400);
                    }
                  } catch (e: unknown) {
                    setScanError(errorMessage(e, "Produkt konnte nicht erstellt werden."));
                  }
                }}
              >
                Produkt anlegen
              </Button>
              <ButtonSecondary
                className="w-full h-14 text-lg"
                onClick={() => {
                  setUnknownBarcode(null);
                  setNewProductBrand("");
                  setNewProductName("");
                  setNewProductZusatz("");
                  setNewProductShortName("");
                  setNewShortTouched(false);
                }}
              >
                Abbrechen
              </ButtonSecondary>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {scanSheet ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-black">Produkt erkannt</div>
                <div className="text-2xl font-black leading-tight text-black">
                  {scanSheet.productName}
                </div>
              </div>
              <button
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
                onClick={() => setScanSheet(null)}
              >
                Schließen
              </button>
            </div>

            {scanMode === "choose" ? (
              <div className="mt-5 grid gap-3">
                <Button
                  className="w-full h-14 text-lg"
                  onClick={() => setScanMode("set")}
                >
                  Bestand setzen
                </Button>
                <ButtonSecondary
                  className="w-full h-14 text-lg"
                  onClick={() => setScanMode("add")}
                >
                  + Hinzufügen
                </ButtonSecondary>
              </div>
            ) : null}

            {scanMode === "set" ? (
              <div className="mt-5 grid gap-3">
                <div className="text-sm font-black text-black">
                  Gesamtanzahl
                </div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={setQty}
                  onChange={(ev) =>
                    setSetQty(ev.target.value.replace(/[^\d]/g, ""))
                  }
                  className="h-14 w-full rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black outline-none focus:ring-2 focus:ring-black/20"
                  autoFocus
                />
                <Button
                  className="w-full h-14 text-lg"
                  onClick={() => {
                    const n = Number(setQty || "0");
                    const next = Number.isFinite(n) ? Math.max(0, n) : 0;
                    setQuantities((m) => ({ ...m, [scanSheet.productId]: next }));
                    scheduleSave(scanSheet.productId, next);
                    setScanSheet(null);
                    setTimeout(() => qtyInputs.current[scanSheet.productId]?.focus(), 50);
                  }}
                >
                  Speichern
                </Button>
                <ButtonSecondary
                  className="w-full h-12"
                  onClick={() => setScanMode("choose")}
                >
                  Zurück
                </ButtonSecondary>
              </div>
            ) : null}

            {scanMode === "add" ? (
              <div className="mt-5 grid gap-3">
                <div className="text-sm text-black">
                  Aktuell:{" "}
                  <span className="font-black">
                    {quantities[scanSheet.productId] ?? 0}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <ButtonSecondary
                    className="h-14 text-lg"
                    onClick={() => setAddQty("1")}
                  >
                    +1
                  </ButtonSecondary>
                  <ButtonSecondary
                    className="h-14 text-lg"
                    onClick={() => setAddQty("6")}
                  >
                    +6
                  </ButtonSecondary>
                </div>

                <div>
                  <div className="text-sm font-black text-black">+X</div>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={addQty}
                    onChange={(ev) =>
                      setAddQty(ev.target.value.replace(/[^\d]/g, ""))
                    }
                    className="mt-2 h-14 w-full rounded-2xl border-2 border-black bg-white px-4 text-center text-2xl font-black text-black outline-none focus:ring-2 focus:ring-black/20"
                  />
                </div>

                <Button
                  className="w-full h-14 text-lg"
                  onClick={() => {
                    void (async () => {
                      const inc = Number(addQty || "1");
                      const add = Number.isFinite(inc) ? Math.max(0, inc) : 1;
                      const ok = await addPositiveDelta(scanSheet.productId, add);
                      if (ok) {
                        setScanSheet(null);
                        setTimeout(
                          () => qtyInputs.current[scanSheet.productId]?.focus(),
                          50
                        );
                      }
                    })();
                  }}
                >
                  Speichern
                </Button>
                <ButtonSecondary
                  className="w-full h-12"
                  onClick={() => setScanMode("choose")}
                >
                  Zurück
                </ButtonSecondary>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {refillToast ? (
        <div className="fixed bottom-28 left-4 right-4 z-[60] rounded-2xl border-2 border-black bg-emerald-700 px-4 py-3 text-center text-sm font-black text-white shadow-lg">
          {refillToast}
        </div>
      ) : null}

      {quickEdit ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Letzte Änderungen</div>
                <div className="text-2xl font-black leading-tight truncate text-black">
                  {quickEdit.productName}
                </div>
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99] shrink-0"
                onClick={() => setQuickEdit(null)}
              >
                Schließen
              </button>
            </div>

            <p className="mt-2 text-sm text-black/60">
              Die letzten fünf gespeicherten Bestände (neueste zuerst). Löschen
              entfernt den Eintrag und stellt den Bestand auf den nächstälteren
              Stand zurück.
            </p>

            {quickHistoryLoading ? (
              <div className="mt-6 text-black font-black">Lade…</div>
            ) : null}

            {historyErr ? (
              <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800">{historyErr}</div>
            ) : null}

            {!quickHistoryLoading && !historyErr && quickHistoryRows.length === 0 ? (
              <div className="mt-6 rounded-2xl border-2 border-dashed border-black/25 p-4 text-center text-sm font-black text-black/60">
                Noch keine Einträge im Verlauf.
              </div>
            ) : null}

            <ul className="mt-4 space-y-2">
              {quickHistoryRows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-lg font-black text-black tabular-nums">
                      Bestand: {row.quantity}
                    </div>
                    <div className="text-sm font-black text-black/60">
                      {formatHistoryTimestamp(row.timestamp)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canWrite || historyDeleteId === row.id}
                    onClick={() => void deleteHistoryRow(row)}
                    className="h-10 shrink-0 rounded-2xl border-2 border-red-700 bg-red-50 px-3 text-sm font-black text-red-800 active:scale-[0.99] disabled:opacity-40"
                  >
                    {historyDeleteId === row.id ? "…" : "Löschen"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* barcode creation moved to /overview */}
    </div>
  );
}

// (intentionally no low-stock/favorites/bulk logic)

