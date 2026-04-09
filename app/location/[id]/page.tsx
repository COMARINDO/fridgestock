"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary, Input } from "@/app/_components/ui";
import {
  getInventoryForLocation,
  getInventoryHistoryForLocation,
  getLocation,
  getProductByBarcode,
  listProducts,
  listUsers,
  createProductWithBarcode,
  setInventoryQuantity,
} from "@/lib/db";
import type { InventoryHistoryRow, Location, Product } from "@/lib/types";
import { useAuth } from "@/app/providers";
import { errorMessage } from "@/lib/error";
import { enqueueWrite, flushQueue, pendingCount } from "@/lib/offlineQueue";
import { useFavorites } from "@/lib/useFavorites";

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
  const { user } = useAuth();

  const [location, setLocation] = useState<Location | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [sortLowFirst, setSortLowFirst] = useState(true);
  const [bulkMode, setBulkMode] = useState(false);
  const [pending, setPending] = useState(() => pendingCount());
  const [latestByProduct, setLatestByProduct] = useState<
    Record<string, { timestamp: string; userName: string | null; quantity: number }>
  >({});
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

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingQty = useRef<Record<string, number>>({});
  const qtyInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { favs, toggle: toggleFav } = useFavorites(user?.id ?? null, locationId);

  useEffect(() => {
    const onOnline = () => {
      void flushQueue(async (w) => {
        await setInventoryQuantity({
          userId: w.userId,
          locationId: w.locationId,
          productId: w.productId,
          quantity: w.quantity,
        });
      }).finally(() => setPending(pendingCount()));
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (!locationId) {
      router.replace("/");
      return;
    }

    (async () => {
      setError(null);
      try {
        // Speed: load core data first (location + products + inventory)
        const [loc, prods, inv] = await Promise.all([
          getLocation(locationId),
          listProducts(),
          getInventoryForLocation(locationId),
        ]);

        if (!loc) {
          setError("Location nicht gefunden.");
          setLocation(null);
          return;
        }

        setLocation(loc);
        setProducts(prods);

        const q: Record<string, number> = {};
        for (const p of prods) q[p.id] = 0;
        for (const row of inv) q[row.product_id] = row.quantity;
        setQuantities(q);

        // Load "zuletzt geändert" data after initial render
        void (async () => {
          try {
            const [hist, users] = await Promise.all([
              getInventoryHistoryForLocation(locationId, 300),
              listUsers(),
            ]);

            const userMap = new Map<string, string>();
            for (const u of users) userMap.set(u.id, u.name);

            const latest = computeLatest(hist, userMap);
            setLatestByProduct(latest);
          } catch {
            // Non-critical: ignore
          }
        })();
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Daten nicht laden."));
      }
    })();
  }, [locationId, router]);

  async function runSave(productId: string) {
    if (!user) return;
    const nextQty = pendingQty.current[productId];
    if (nextQty === undefined) return;

    try {
      await setInventoryQuantity({
        userId: user.id,
        locationId,
        productId,
        quantity: nextQty,
      });
      setSaveState((s) => ({ ...s, [productId]: "saved" }));
      setLatestByProduct((prev) => ({
        ...prev,
        [productId]: {
          timestamp: new Date().toISOString(),
          userName: user.name,
          quantity: nextQty,
        },
      }));

      setTimeout(() => {
        setSaveState((s) =>
          s[productId] === "saved" ? { ...s, [productId]: "idle" } : s
        );
      }, 650);
    } catch {
      setSaveState((s) => ({ ...s, [productId]: "error" }));
      // Offline / flaky network: queue and show pending badge
      enqueueWrite({
        userId: user.id,
        locationId,
        productId,
        quantity: nextQty,
      });
      setPending(pendingCount());
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
    const filtered = !t
      ? products
      : products.filter((p) => p.name.toLowerCase().includes(t));

    const withStatus = filtered.map((p) => {
      const qty = quantities[p.id] ?? 0;
      const status = stockStatus(qty, p.min_quantity);
      return { p, qty, status };
    });

    const lowFiltered = showLowOnly
      ? withStatus.filter((x) => x.status !== "ok")
      : withStatus;

    const sorted = sortLowFirst
      ? [...lowFiltered].sort((a, b) => statusRank(a.status) - statusRank(b.status))
      : lowFiltered;

    const favSet = new Set(favs);
    const favSorted = [...sorted].sort((a, b) => {
      const af = favSet.has(a.p.id) ? 0 : 1;
      const bf = favSet.has(b.p.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.p.name.localeCompare(b.p.name);
    });

    return favSorted.map((x) => x.p);
  }, [products, query, quantities, showLowOnly, sortLowFirst, favs]);

  const lowCounts = useMemo(() => {
    let critical = 0;
    let low = 0;
    for (const p of products) {
      const s = stockStatus(quantities[p.id] ?? 0, p.min_quantity);
      if (s === "critical") critical++;
      else if (s === "low") low++;
    }
    return { critical, low };
  }, [products, quantities]);

  if (error) {
    return (
      <div className="flex-1 flex flex-col bg-zinc-50">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur">
          <div className="mx-auto w-full max-w-2xl px-5 py-4 flex items-center justify-between">
            <div className="text-xl font-extrabold">Location</div>
            <Link href="/" className="text-sm font-semibold text-zinc-700">
              Home
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl px-5 py-6">
          <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-600">Location</div>
              <div className="text-xl font-extrabold leading-tight">
                {location?.name ?? "…"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/location/${locationId}/history`}
                className="h-10 px-3 inline-flex items-center rounded-xl border border-zinc-200 bg-white text-sm font-semibold"
              >
                History
              </Link>
              <Link href="/" className="text-sm font-semibold text-zinc-700">
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

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-600">
              {lowCounts.critical > 0 ? (
                <span className="font-semibold text-red-700">
                  kritisch: {lowCounts.critical}
                </span>
              ) : (
                <span>kritisch: 0</span>
              )}
              {" · "}
              {lowCounts.low > 0 ? (
                <span className="font-semibold text-orange-700">
                  wenig: {lowCounts.low}
                </span>
              ) : (
                <span>wenig: 0</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {pending > 0 ? (
                <div className="h-10 px-3 rounded-xl border border-orange-200 bg-orange-50 text-orange-800 text-sm font-semibold flex items-center">
                  pending: {pending}
                </div>
              ) : null}
              <button
                className={[
                  "h-10 px-3 rounded-xl text-sm font-semibold border",
                  showLowOnly
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-950 border-zinc-200",
                ].join(" ")}
                onClick={() => setShowLowOnly((v) => !v)}
              >
                Low-Stock
              </button>
              <button
                className={[
                  "h-10 px-3 rounded-xl text-sm font-semibold border",
                  sortLowFirst
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-950 border-zinc-200",
                ].join(" ")}
                onClick={() => setSortLowFirst((v) => !v)}
              >
                Sort
              </button>
              <button
                className={[
                  "h-10 px-3 rounded-xl text-sm font-semibold border",
                  bulkMode
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-950 border-zinc-200",
                ].join(" ")}
                onClick={() => setBulkMode((v) => !v)}
              >
                Bulk
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-4 pb-24">
        <div className="grid gap-3">
          {visibleProducts.map((p, idx) => {
            const qty = quantities[p.id] ?? 0;
            const state = saveState[p.id] ?? "idle";
            const latest = latestByProduct[p.id];
            const status = stockStatus(qty, p.min_quantity);
            const isFav = favs.includes(p.id);

            return (
              <div
                key={p.id}
                className={[
                  "rounded-3xl border bg-white p-4 shadow-sm",
                  status === "ok"
                    ? "border-black/10"
                    : status === "low"
                      ? "border-[#c8a27a]"
                      : "border-red-300",
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
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-extrabold">{p.name}</div>
                    <div className="mt-1 text-sm text-zinc-600">
                      min: {p.min_quantity}
                      {latest ? (
                        <>
                          {" · "}
                          zuletzt:{" "}
                          <span className="font-semibold">
                            {latest.userName ?? "?"}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className={[
                      "h-8 px-3 rounded-full text-sm font-bold flex items-center",
                      status === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : status === "low"
                          ? "bg-orange-50 text-orange-700"
                          : "bg-red-50 text-red-700",
                    ].join(" ")}
                  >
                    {state === "saving"
                      ? "speichert…"
                      : state === "saved"
                        ? "gespeichert"
                        : state === "error"
                          ? "Fehler"
                          : status === "ok"
                            ? "ok"
                            : status === "low"
                              ? "wenig"
                              : "kritisch"}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <button
                    className={[
                      "h-10 px-3 rounded-xl text-sm font-semibold border",
                      isFav
                        ? "bg-zinc-900 text-white border-zinc-900"
                        : "bg-white text-zinc-950 border-zinc-200",
                    ].join(" ")}
                    onClick={() => {
                      toggleFav(p.id);
                    }}
                  >
                    {isFav ? "★ Favorit" : "☆ Favorit"}
                  </button>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    className="h-14 w-14 rounded-2xl border border-zinc-200 bg-white text-2xl font-extrabold active:scale-[0.99]"
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
                      void runSave(p.id).finally(() => {
                        if (!bulkMode) return;
                        const next = visibleProducts[idx + 1];
                        if (!next) return;
                        qtyInputs.current[next.id]?.focus();
                      });
                    }}
                    ref={(el) => {
                      qtyInputs.current[p.id] = el;
                    }}
                    className="h-14 flex-1 rounded-3xl border border-black/10 bg-[#f5efe6] px-4 text-center text-3xl font-extrabold outline-none focus:border-black/30"
                    aria-label="quantity"
                  />

                  <button
                    className="h-14 w-14 rounded-2xl bg-zinc-900 text-white text-2xl font-extrabold active:scale-[0.99]"
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
          <ButtonSecondary className="w-full" onClick={() => router.replace("/")}>
            Zurück zu Locations
          </ButtonSecondary>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-zinc-50/95 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-3 flex gap-2">
          <Button className="w-full h-14 text-lg" onClick={() => setScannerOpen(true)}>
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
            <div className="mt-1 text-sm text-zinc-600 font-mono">
              {unknownBarcode}
            </div>

            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-sm font-extrabold">Vorschlag (Open Food Facts)</div>
              {offLoading ? (
                <div className="mt-1 text-sm text-zinc-600">Suche…</div>
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
                <div className="mt-1 text-sm text-zinc-600">
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
                    const prods = await listProducts();
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
                <div className="text-xs text-zinc-600">Produkt erkannt</div>
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
                <div className="text-sm text-zinc-600">
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
    </div>
  );
}

function computeLatest(
  history: InventoryHistoryRow[],
  userMap: Map<string, string>
) {
  const latest: Record<
    string,
    { timestamp: string; userName: string | null; quantity: number }
  > = {};

  for (const h of history) {
    if (latest[h.product_id]) continue;
    latest[h.product_id] = {
      timestamp: h.timestamp,
      userName: h.user_id ? userMap.get(h.user_id) ?? null : null,
      quantity: h.quantity,
    };
  }

  return latest;
}

function stockStatus(
  qty: number,
  min: number
): "ok" | "low" | "critical" {
  if (min <= 0) return "ok";
  if (qty <= min) return "critical";
  if (qty <= min + 2) return "low";
  return "ok";
}

function statusRank(s: "ok" | "low" | "critical") {
  // lower = earlier in list
  if (s === "critical") return 0;
  if (s === "low") return 1;
  return 2;
}

