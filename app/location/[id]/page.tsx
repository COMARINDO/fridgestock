"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
import {
  resolveInventoryLocation,
  getProductByBarcode,
  listProductsWithInventoryForLocation,
  createProductWithBarcode,
  updateProductBarcode,
  setInventoryQuantity,
} from "@/lib/db";
import type { Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import JsBarcode from "jsbarcode";

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
  const [query, setQuery] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [scanSheet, setScanSheet] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  const [scanMode, setScanMode] = useState<"choose" | "set" | "add">("choose");
  const [setQty, setSetQty] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [offLoading, setOffLoading] = useState(false);
  const [offSuggestion, setOffSuggestion] = useState<string | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  const [barcodeModal, setBarcodeModal] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  const [shortName, setShortName] = useState("");
  const [genBarcode, setGenBarcode] = useState<string>("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeErr, setBarcodeErr] = useState<string | null>(null);
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingQty = useRef<Record<string, number>>({});
  const qtyInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  async function handleBarcode(codeRaw: string) {
    const code = codeRaw.trim();
    if (!code) return;
    setScanError(null);

    try {
      const p = await getProductByBarcode(code);
      if (!p) {
        setUnknownBarcode(code);
        setNewProductName("");
        setOffSuggestion(null);
        setOffError(null);
        return;
      }

      setHighlightId(p.id);
      setTimeout(() => setHighlightId(null), 900);

      setTimeout(() => {
        rowRefs.current[p.id]?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }, 60);

      setScanSheet({ productId: p.id, productName: p.name });
      setScanMode("choose");
      setSetQty(String(quantities[p.id] ?? 0));
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
        // Open Food Facts product endpoint
        const res = await fetch(
          `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
            code
          )}.json`
        );
        if (!res.ok) throw new Error("Open Food Facts nicht erreichbar.");
        const json: unknown = await res.json();
        const j = json as {
          product?: {
            product_name?: unknown;
            product_name_de?: unknown;
            generic_name?: unknown;
          };
        };

        const name =
          (typeof j.product?.product_name === "string" && j.product.product_name) ||
          (typeof j.product?.product_name_de === "string" && j.product.product_name_de) ||
          (typeof j.product?.generic_name === "string" && j.product.generic_name) ||
          null;
        if (cancelled) return;
        if (typeof name === "string" && name.trim()) {
          const clean = name.trim();
          setOffSuggestion(clean);
          // Pre-fill if user hasn't typed yet
          setNewProductName((cur) => (cur.trim() ? cur : clean));
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

  useEffect(() => {
    if (!scannerOpen) return;

    let stop = false;
    let html5:
      | null
      | {
          start: (
            config: unknown,
            options: Record<string, unknown>,
            onSuccess: (decodedText: string) => void
          ) => Promise<void>;
          stop: () => Promise<void>;
          clear: () => Promise<void>;
        } = null;

    (async () => {
      setScanError(null);
      try {
        const mod = await import("html5-qrcode");
        if (stop) return;
        const m = mod as unknown as {
          Html5Qrcode: new (id: string) => {
            start: (
              config: unknown,
              options: Record<string, unknown>,
              onSuccess: (decodedText: string) => void
            ) => Promise<void>;
            stop: () => Promise<void>;
            clear: () => Promise<void>;
          };
          Html5QrcodeSupportedFormats: Record<string, number>;
        };
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = m;

        html5 = new Html5Qrcode("barcode-reader");
        await html5.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: { width: 280, height: 180 },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
            ],
          },
          async (decodedText: string) => {
            try {
              navigator.vibrate?.(40);
            } catch {}
            setScannerOpen(false);
            try {
              if (html5) {
                await html5.stop();
                await html5.clear();
              }
            } catch {
              // ignore
            }
            await handleBarcode(decodedText);
          }
        );
      } catch (e: unknown) {
        setScanError(errorMessage(e, "Scanner konnte nicht gestartet werden."));
      }
    })();

    return () => {
      stop = true;
      (async () => {
        try {
          if (html5) {
            await html5.stop();
            await html5.clear();
          }
        } catch {
          // ignore
        }
      })();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  const visibleProducts = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return products;
    return products.filter((p) => p.name.toLowerCase().includes(t));
  }, [products, query]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur">
          <div className="w-full px-4 py-4 flex items-center justify-between">
            <div className="text-xl font-extrabold">Location</div>
            <Link href="/" className="text-sm font-semibold text-zinc-700">
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
      <header className="sticky top-0 z-10 border-b border-black/10 bg-[var(--background)]/90 backdrop-blur">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-[#1f1f1f]">Location</div>
              <div className="text-xl font-extrabold leading-tight">
                {inventoryLoc && location?.parent_id
                  ? `${inventoryLoc.name} – ${location.name}`
                  : (location?.name ?? "…")}
              </div>
              {inventoryLoc && location?.parent_id ? (
                <div className="mt-1 text-[14px] text-[#1f1f1f]">
                  Bestand von: <span className="font-semibold">{inventoryLoc.name}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-[15px] font-semibold text-[#2c2c2c]">
                Home
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Produkt suchen…"
              autoFocus
            />
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-4 pb-28">
        <div className="grid gap-3">
          {visibleProducts.map((p) => {
            const qty = quantities[p.id] ?? 0;
            const state = saveState[p.id] ?? "idle";

            return (
              <div
                key={p.id}
                className={[
                  "w-full max-w-full rounded-3xl border bg-white p-4 shadow-sm",
                  "border-black/10",
                  highlightId === p.id ? "ring-2 ring-emerald-500" : "",
                ].join(" ")}
                onClick={(e) => {
                  // Click-to-focus quantity input (fast)
                  if ((e.target as HTMLElement).tagName.toLowerCase() === "button") return;
                  qtyInputs.current[p.id]?.focus();
                }}
                ref={(el) => {
                  rowRefs.current[p.id] = el;
                }}
              >
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-lg font-extrabold">{p.name}</div>
                  </div>

                  <div
                    className={[
                      "h-9 px-4 rounded-full text-[15px] font-bold flex items-center",
                      "bg-black/5 text-[#2c2c2c]",
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

                {!p.barcode ? (
                  <div className="mt-3">
                    <button
                      className="w-full rounded-3xl border border-black/10 bg-white px-4 py-4 text-[17px] font-semibold"
                      onClick={() => {
                        setBarcodeModal({ productId: p.id, productName: p.name });
                        setShortName((p.short_name ?? "").trim());
                        setGenBarcode("");
                        setBarcodeErr(null);
                      }}
                    >
                      Barcode erstellen
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center gap-3">
                  <button
                    className="h-14 w-14 rounded-3xl border border-black/10 bg-white text-2xl font-extrabold active:scale-[0.99]"
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

                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={String(qty)}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/[^\d]/g, ""));
                      const next = Number.isFinite(v) ? v : 0;
                      setQuantities((m) => ({ ...m, [p.id]: next }));
                      scheduleSave(p.id, next);
                    }}
                    onFocus={(e) => {
                      // select all for quick overwrite
                      e.currentTarget.select();
                    }}
                    onBlur={() => {
                      // ensure save fires immediately when leaving field
                      if (timers.current[p.id]) clearTimeout(timers.current[p.id]);
                      void runSave(p.id);
                    }}
                    ref={(el) => {
                      qtyInputs.current[p.id] = el;
                    }}
                    className="h-14 flex-1 rounded-3xl border border-black/10 bg-[#f5efe6] px-4 text-center text-3xl font-extrabold outline-none focus:border-black/30"
                    aria-label="quantity"
                  />

                  <button
                    className="h-14 w-14 rounded-3xl bg-[#6f4e37] text-white text-2xl font-extrabold active:scale-[0.99]"
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

        <div className="mt-6">
          <ButtonSecondary className="" onClick={() => router.replace("/")}>
            Zurück zu Locations
          </ButtonSecondary>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-black/10 bg-[var(--background)]/95 backdrop-blur">
        <div className="w-full px-4 py-3 flex gap-2">
          <Button className="h-14 text-lg" onClick={() => setScannerOpen(true)}>
            SCAN PRODUKT
          </Button>
        </div>
      </div>

      {scannerOpen ? (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between text-white">
            <div className="font-extrabold">Barcode Scan</div>
            <button
              className="h-10 px-3 rounded-xl bg-white/15 text-sm font-semibold"
              onClick={() => setScannerOpen(false)}
            >
              Schließen
            </button>
          </div>
          <div className="absolute inset-0 top-16">
            <div id="barcode-reader" className="h-full w-full" />
          </div>
          {scanError ? (
            <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-red-600/90 p-4 text-white">
              {scanError}
            </div>
          ) : null}
        </div>
      ) : null}

      {unknownBarcode ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5">
            <div className="text-lg font-extrabold">Produkt nicht gefunden</div>
            <div className="mt-1 text-sm text-[#1f1f1f] font-mono">
              {unknownBarcode}
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-sm font-extrabold">Vorschlag (Open Food Facts)</div>
              {offLoading ? (
                <div className="mt-1 text-sm text-[#1f1f1f]">Suche…</div>
              ) : offSuggestion ? (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{offSuggestion}</div>
                  <button
                    className="h-10 px-3 rounded-xl bg-zinc-900 text-white text-sm font-semibold"
                    onClick={() => setNewProductName(offSuggestion)}
                  >
                    Übernehmen
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-sm text-[#1f1f1f]">
                  {offError ?? "Kein Vorschlag."}
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-zinc-700">Name</div>
              <Input
                value={newProductName}
                onChange={(ev) => setNewProductName(ev.target.value)}
                placeholder="z.B. Coca-Cola"
                autoFocus
              />
            </div>

            <div className="mt-4 grid gap-2">
              <Button
                className="w-full h-14 text-lg"
                disabled={!newProductName.trim()}
                onClick={async () => {
                  if (!unknownBarcode) return;
                  try {
                    await createProductWithBarcode({
                      name: newProductName.trim(),
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
                    setNewProductName("");
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
                  setNewProductName("");
                }}
              >
                Abbrechen
              </ButtonSecondary>
            </div>
          </div>
        </div>
      ) : null}

      {scanSheet ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-[#1f1f1f]">Produkt erkannt</div>
                <div className="text-2xl font-extrabold leading-tight">
                  {scanSheet.productName}
                </div>
              </div>
              <button
                className="h-10 px-3 rounded-2xl bg-black/5 text-sm font-semibold"
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
                <div className="text-sm font-semibold text-zinc-700">
                  Gesamtanzahl
                </div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={setQty}
                  onChange={(ev) =>
                    setSetQty(ev.target.value.replace(/[^\d]/g, ""))
                  }
                  className="h-14 w-full rounded-3xl border border-black/10 bg-[#f5efe6] px-4 text-center text-3xl font-extrabold outline-none focus:border-black/30"
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
                <div className="text-sm text-[#1f1f1f]">
                  Aktuell:{" "}
                  <span className="font-extrabold">
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
                  <div className="text-sm font-semibold text-zinc-700">+X</div>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={addQty}
                    onChange={(ev) =>
                      setAddQty(ev.target.value.replace(/[^\d]/g, ""))
                    }
                    className="mt-2 h-14 w-full rounded-3xl border border-black/10 bg-white px-4 text-center text-2xl font-extrabold outline-none focus:border-black/30"
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

      {barcodeModal ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-[#1f1f1f]">Barcode Label</div>
                <div className="text-2xl font-extrabold leading-tight truncate">
                  {barcodeModal.productName}
                </div>
              </div>
              <button
                className="h-10 px-3 rounded-2xl bg-black/5 text-sm font-semibold"
                onClick={() => setBarcodeModal(null)}
              >
                Schließen
              </button>
            </div>

            <div className="mt-4">
              <div className="text-sm font-semibold text-[#1f1f1f]">
                Kurzname (Label)
              </div>
              <Input
                value={shortName}
                onChange={(ev) => setShortName(ev.target.value)}
                placeholder='z.B. "co 0,5"'
                className="mt-2"
              />
            </div>

            <div className="mt-4 rounded-3xl border border-black/10 bg-white p-4">
              <div className="text-sm font-semibold text-[#1f1f1f]">
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
                      fontWeight: 700,
                      textAlign: "center",
                      color: "#1f1f1f",
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
                <div className="mt-2 text-center text-xs font-mono text-[#1f1f1f]">
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
                  setGenBarcode(`PENZI${base}${rand}`); // CODE128 friendly
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
                    const prods = await listProductsWithInventoryForLocation(
                      inventoryLoc?.id ?? locationId
                    );
                    setProducts(prods);
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
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 6mm;
      padding: 2mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1mm;
    }
    .name { font-size: 7pt; font-weight: 700; text-align: center; color: #000; line-height: 1.1; }
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

// (intentionally no low-stock/favorites/bulk logic)

