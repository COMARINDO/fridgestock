"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
import {
  resolveInventoryLocation,
  getProductByBarcode,
  listProductsWithInventoryForLocation,
  createProductWithBarcode,
  setInventoryQuantity,
} from "@/lib/db";
import type { Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, NotFoundException } from "@zxing/library";
import { suggestShortName } from "@/lib/shortName";
import { splitNameToBrandProduct } from "@/lib/brandProduct";
import { formatProductName } from "@/lib/formatProductName";
import { groupProducts } from "@/lib/groupProducts";

type SaveState = "idle" | "saving" | "saved" | "error";

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

  const [location, setLocation] = useState<Location | null>(null);
  const [inventoryLoc, setInventoryLoc] = useState<Location | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
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
  const qtyInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
        // Inventory is ONLY stored on the parent location.
        // Sub-locations (parent_id != null) are UI grouping only.
        const resolved = await resolveInventoryLocation(locationId);
        const uiLoc = resolved.uiLocation;
        const invLoc = resolved.inventoryLocation;
        const rows = await listProductsWithInventoryForLocation(invLoc.id);

        setLocation(uiLoc);
        setInventoryLoc(invLoc);
        setProducts(rows);

        const q: Record<string, number> = {};
        for (const p of rows) q[p.id] = p.quantity ?? 0;
        setQuantities(q);
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Daten nicht laden."));
      }
    })();
  }, [locationId, router]);

  async function runSave(productId: string) {
    if (!inventoryLoc) return;
    const nextQty = pendingQty.current[productId];
    if (nextQty === undefined) return;

    try {
      await setInventoryQuantity({
        locationId: inventoryLoc.id,
        productId,
        quantity: nextQty,
      });
      setSaveState((s) => ({ ...s, [productId]: "saved" }));

      setTimeout(() => {
        setSaveState((s) =>
          s[productId] === "saved" ? { ...s, [productId]: "idle" } : s
        );
      }, 650);
    } catch {
      setSaveState((s) => ({ ...s, [productId]: "error" }));
    }
  }

  function scheduleSave(productId: string, nextQty: number) {
    pendingQty.current[productId] = nextQty;

    if (timers.current[productId]) clearTimeout(timers.current[productId]);
    setSaveState((s) => ({ ...s, [productId]: "saving" }));

    timers.current[productId] = setTimeout(async () => {
      await runSave(productId);
    }, 200); // ~200ms debounce
  }

  async function saveImmediate(productId: string, nextQty: number) {
    if (!inventoryLoc) return;
    pendingQty.current[productId] = nextQty;
    setSaveState((s) => ({ ...s, [productId]: "saving" }));
    try {
      await setInventoryQuantity({
        locationId: inventoryLoc.id,
        productId,
        quantity: nextQty,
      });
      setSaveState((s) => ({ ...s, [productId]: "saved" }));
      setTimeout(() => {
        setSaveState((s) =>
          s[productId] === "saved" ? { ...s, [productId]: "idle" } : s
        );
      }, 450);
    } catch {
      setSaveState((s) => ({ ...s, [productId]: "error" }));
    }
  }

  function focusQtyInput(productId: string) {
    setTimeout(() => {
      const el = qtyInputs.current[productId];
      el?.focus();
      el?.select?.();
    }, 0);
  }

  async function handleBarcode(codeRaw: string) {
    const code = codeRaw.trim();
    if (!code) return;
    setScanError(null);

    try {
      // Ignore duplicate scans within short time.
      const now = Date.now();
      if (lastScanRef.current.code === code && now - lastScanRef.current.at < 900) return;
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
  }

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
  }, [scannerOpen]);

  const visibleProducts = useMemo(() => products, [products]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <header className="sticky top-0 z-10 border-b-2 border-black bg-[var(--background)]">
          <div className="w-full px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="Bstand" width={36} height={36} />
              <div className="text-xl font-black text-black">Location</div>
            </div>
            <Link href="/" className="text-sm font-black text-black">
              Home
            </Link>
          </div>
        </header>
        <main className="w-full px-4 py-6">
          <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 border-b-2 border-black bg-[var(--background)]">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Image src="/logo.svg" alt="Bstand" width={36} height={36} />
              <div className="min-w-0">
                <div className="text-[13px] text-black">Location</div>
                <div className="text-xl font-black leading-tight text-black truncate">
                  {inventoryLoc && location?.parent_id
                    ? `${inventoryLoc.name} – ${location.name}`
                    : (location?.name ?? "…")}
                </div>
                {inventoryLoc && location?.parent_id ? (
                  <div className="mt-1 text-[14px] text-black truncate">
                    Bestand von:{" "}
                    <span className="font-black">{inventoryLoc.name}</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-[15px] font-black text-black">
                Home
              </Link>
            </div>
          </div>

        </div>
      </header>

      <main className="w-full px-4 py-4 pb-28">
        {Object.entries(groupProducts(visibleProducts)).map(([brand, items]) => (
          <div key={brand} className="mt-2">
            <div className="text-[18px] font-black text-black">{brand}</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((p) => {
                const qty = quantities[p.id] ?? 0;
                const state = saveState[p.id] ?? "idle";

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
                      longPressFiredRef.current = false;
                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = setTimeout(() => {
                        longPressFiredRef.current = true;
                        setEditingId(p.id);
                        focusQtyInput(p.id);
                      }, 500);
                    }}
                    onTouchEnd={(e) => {
                      const t = e.target as HTMLElement;
                      const tag = t.tagName.toLowerCase();
                      if (tag === "button" || tag === "input") return;
                      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
                      touchTimerRef.current = null;
                      if (longPressFiredRef.current) return;

                      const cur = quantitiesRef.current[p.id] ?? 0;
                      const next = cur + 1;
                      quantitiesRef.current = { ...quantitiesRef.current, [p.id]: next };
                      setQuantities((prev) => ({ ...prev, [p.id]: next }));
                      void saveImmediate(p.id, next);
                      setHighlightId(p.id);
                      setTimeout(() => setHighlightId(null), 350);
                    }}
                    ref={(el) => {
                      rowRefs.current[p.id] = el;
                    }}
                  >
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="text-lg font-black text-black">
                          {formatProductName(p)}
                        </div>
                      </div>

                      <div
                        className={[
                          "h-10 px-4 rounded-full text-[15px] font-black flex items-center",
                          state === "error"
                            ? "bg-white text-black border-2 border-black"
                            : "bg-black text-white",
                        ].join(" ")}
                      >
                        {state === "saving"
                          ? "speichert…"
                          : state === "saved"
                            ? "gespeichert"
                            : state === "error"
                              ? "Fehler"
                              : "ok"}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-3 min-w-0">
                      <button
                        className="h-14 w-14 rounded-2xl border-2 border-black bg-white text-2xl font-black text-black active:scale-[0.99]"
                        onClick={() => {
                          const next = Math.max(0, qty - 1);
                          setQuantities((m) => ({ ...m, [p.id]: next }));
                          scheduleSave(p.id, next);
                          qtyInputs.current[p.id]?.focus();
                        }}
                        aria-label="minus"
                      >
                        −
                      </button>

                      {editingId === p.id ? (
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(qty)}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(/[^\d]/g, ""));
                            const next = Number.isFinite(v) ? v : 0;
                            quantitiesRef.current = { ...quantitiesRef.current, [p.id]: next };
                            setQuantities((m) => ({ ...m, [p.id]: next }));
                            scheduleSave(p.id, next);
                          }}
                          onFocus={(e) => {
                            e.currentTarget.select();
                          }}
                          onBlur={() => {
                            if (timers.current[p.id]) clearTimeout(timers.current[p.id]);
                            void runSave(p.id);
                            setEditingId((cur) => (cur === p.id ? null : cur));
                          }}
                          ref={(el) => {
                            qtyInputs.current[p.id] = el;
                          }}
                          className="h-14 flex-1 min-w-0 rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black outline-none focus:ring-2 focus:ring-black/20"
                          aria-label="quantity"
                          autoFocus
                        />
                      ) : (
                        <div
                          className="h-14 flex-1 min-w-0 rounded-2xl border-2 border-black bg-white px-4 text-center text-3xl font-black text-black flex items-center justify-center select-none"
                          aria-label="quantity"
                        >
                          {qty}
                        </div>
                      )}

                      <button
                        className="h-14 w-14 rounded-2xl bg-black text-white text-2xl font-black active:scale-[0.99]"
                        onClick={() => {
                          const next = qty + 1;
                          setQuantities((m) => ({ ...m, [p.id]: next }));
                          scheduleSave(p.id, next);
                          qtyInputs.current[p.id]?.focus();
                        }}
                        aria-label="plus"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-6">
          <ButtonSecondary className="" onClick={() => router.replace("/")}>
            Zurück zu Locations
          </ButtonSecondary>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t-2 border-black bg-[var(--background)]">
        <div className="w-full px-4 py-3 flex gap-2">
          <Button className="h-14 text-lg" onClick={() => setScannerOpen(true)}>
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
                            inventoryLoc?.id ?? locationId
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
                      inventoryLoc?.id ?? locationId
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
                    const cur = quantities[scanSheet.productId] ?? 0;
                    const inc = Number(addQty || "1");
                    const add = Number.isFinite(inc) ? Math.max(0, inc) : 1;
                    const next = cur + add;
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
          </div>
        </div>
      ) : null}

      {/* barcode creation moved to /overview */}
    </div>
  );
}

// (intentionally no low-stock/favorites/bulk logic)

