"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  getLatestInventorySnapshotsForLocation,
  getWeeklyUsageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOrderOverrides,
  listProducts,
  upsertOrderOverride,
} from "@/lib/db";
import { computeOrderSuggestion } from "@/lib/orderSuggestions";
import type { Location, OrderOverrideRow, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";

type RowModel = {
  productId: string;
  name: string;
  calculatedOrder: number;
  displayOrder: number;
  overridden: boolean;
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const { isAdmin, exitAdmin, adminHydrated } = useAdmin();

  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [usageByLoc, setUsageByLoc] = useState<
    Record<string, Record<string, number>>
  >({});
  const [inventoryQty, setInventoryQty] = useState<
    Record<string, Record<string, number>>
  >({});
  const [latestSnap, setLatestSnap] = useState<
    Record<string, Record<string, { quantity: number; timestamp: string }>>
  >({});
  const [overrides, setOverrides] = useState<OrderOverrideRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ locId: string; productId: string } | null>(
    null
  );
  const [editDraft, setEditDraft] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const reload = useCallback(async () => {
    setErr(null);
    const [locs, prods, usage, invAll, ovs] = await Promise.all([
      listLocations(),
      listProducts(),
      getWeeklyUsageByLocationProduct({ days: 7 }),
      listInventoryAll(),
      listOrderOverrides(),
    ]);

    const invMap: Record<string, Record<string, number>> = {};
    for (const row of invAll) {
      if (!invMap[row.location_id]) invMap[row.location_id] = {};
      invMap[row.location_id][row.product_id] = Math.max(
        0,
        Math.floor(Number(row.quantity) || 0)
      );
    }

    const snapMap: Record<
      string,
      Record<string, { quantity: number; timestamp: string }>
    > = {};
    await Promise.all(
      locs.map(async (loc) => {
        snapMap[loc.id] = await getLatestInventorySnapshotsForLocation(loc.id);
      })
    );

    setLocations(locs);
    setProducts(prods);
    setUsageByLoc(usage);
    setInventoryQty(invMap);
    setLatestSnap(snapMap);
    setOverrides(ovs);
  }, []);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    (async () => {
      setBusy(true);
      try {
        await reload();
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Bestelldaten nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, [adminHydrated, isAdmin, reload]);

  const overrideByKey = useMemo(() => {
    const m = new Map<string, OrderOverrideRow>();
    for (const o of overrides) {
      m.set(`${o.location_id}:${o.product_id}`, o);
    }
    return m;
  }, [overrides]);

  const rowsByLocation = useMemo(() => {
    const out: Record<string, RowModel[]> = {};
    for (const loc of locations) {
      const list: RowModel[] = [];
      for (const p of products) {
        const usage = Math.max(0, Math.round(usageByLoc[loc.id]?.[p.id] ?? 0));
        const stock = inventoryQty[loc.id]?.[p.id] ?? 0;
        const snap = latestSnap[loc.id]?.[p.id];
        const lastQty = snap ? snap.quantity : stock;
        const lastAt = snap ? new Date(snap.timestamp) : null;
        const { calculatedOrder } = computeOrderSuggestion({
          usage7d: usage,
          lastQuantity: lastQty,
          lastCountAt: lastAt,
        });
        const ov = overrideByKey.get(`${loc.id}:${p.id}`);
        const overridden = ov !== undefined;
        const displayOrder = overridden ? ov!.quantity : calculatedOrder;

        const include =
          usage > 0 ||
          stock > 0 ||
          overridden ||
          calculatedOrder > 0 ||
          displayOrder > 0;
        if (!include) continue;

        list.push({
          productId: p.id,
          name: formatProductName(p),
          calculatedOrder,
          displayOrder,
          overridden,
        });
      }
      list.sort((a, b) => a.name.localeCompare(b.name, "de"));
      out[loc.id] = list;
    }
    return out;
  }, [
    locations,
    products,
    usageByLoc,
    inventoryQty,
    latestSnap,
    overrideByKey,
  ]);

  const totalsByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const loc of locations) {
      for (const r of rowsByLocation[loc.id] ?? []) {
        m[r.productId] = (m[r.productId] ?? 0) + r.displayOrder;
      }
    }
    return m;
  }, [locations, rowsByLocation]);

  async function saveEdit() {
    if (!editing) return;
    const n = Math.max(0, Math.floor(Number(editDraft.replace(/[^\d]/g, "")) || 0));
    setSaveBusy(true);
    setErr(null);
    try {
      await upsertOrderOverride({
        locationId: editing.locId,
        productId: editing.productId,
        quantity: n,
      });
      setEditing(null);
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setSaveBusy(false);
    }
  }

  if (!adminHydrated) {
    return (
      <main className="w-full px-4 py-8 text-center text-black">
        <p className="font-black">Laden…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="w-full px-4 py-8 text-center text-black">
        <p className="font-black">Weiterleitung…</p>
      </main>
    );
  }

  return (
    <main className="w-full px-4 py-4 pb-28 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-black/50">
            <Link href="/admin" className="underline">
              ← Admin
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Bestellübersicht</h1>
          <p className="mt-1 text-sm text-black/65">
            Vorschlag aus 7-Tage-Verbrauch &amp; letztem Zählsnapshot; manuell
            überschreibbar. Neue Zählung am Platzerl setzt Overrides zurück.
          </p>
        </div>
        <button
          type="button"
          className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          onClick={() => {
            exitAdmin();
            router.replace("/login");
          }}
        >
          Admin-Modus beenden
        </button>
      </div>

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err ? (
        <>
          {locations.map((loc) => {
            const rows = rowsByLocation[loc.id] ?? [];
            const sum = rows.reduce((s, r) => s + r.displayOrder, 0);
            return (
              <section key={loc.id} className="mt-10">
                <h2 className="text-xl font-black text-black border-b-2 border-black pb-2">
                  {loc.name}
                </h2>
                {rows.length === 0 ? (
                  <p className="mt-3 text-sm text-black/60">Keine Positionen.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {rows.map((r) => {
                      const isEd =
                        editing?.locId === loc.id && editing?.productId === r.productId;
                      return (
                        <li
                          key={r.productId}
                          className="flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-black text-black truncate">{r.name}</div>
                            {r.overridden ? (
                              <div className="text-[11px] font-black text-amber-800">
                                Manuell (Vorschlag: {r.calculatedOrder})
                              </div>
                            ) : null}
                          </div>
                          {isEd ? (
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                inputMode="numeric"
                                type="tel"
                                className="h-11 w-20 rounded-xl border-2 border-black text-center text-lg font-black"
                                value={editDraft}
                                onChange={(e) =>
                                  setEditDraft(e.target.value.replace(/[^\d]/g, ""))
                                }
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void saveEdit();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                              />
                              <button
                                type="button"
                                disabled={saveBusy}
                                className="h-11 px-3 rounded-xl bg-black text-white text-sm font-black"
                                onClick={() => void saveEdit()}
                              >
                                OK
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="h-11 min-w-[3rem] rounded-xl border-2 border-black bg-white px-3 text-lg font-black tabular-nums text-black active:scale-[0.99]"
                              onClick={() => {
                                setEditing({ locId: loc.id, productId: r.productId });
                                setEditDraft(String(r.displayOrder));
                              }}
                            >
                              {r.displayOrder}
                              {r.overridden ? (
                                <span className="ml-1 text-amber-700" title="Override">
                                  *
                                </span>
                              ) : null}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="mt-3 flex justify-end text-sm font-black text-black">
                  Summe {loc.name}: {sum}
                </div>
              </section>
            );
          })}

          <section className="mt-12 rounded-3xl border-2 border-black bg-white p-4">
            <h2 className="text-lg font-black text-black">TOTAL (alle Platzerl)</h2>
            <ul className="mt-3 space-y-1">
              {Object.entries(totalsByProduct)
                .filter(([, v]) => v > 0)
                .sort((a, b) => {
                  const na =
                    products.find((p) => p.id === a[0])?.product_name ?? "";
                  const nb =
                    products.find((p) => p.id === b[0])?.product_name ?? "";
                  return na.localeCompare(nb, "de");
                })
                .map(([pid, total]) => {
                  const p = products.find((x) => x.id === pid);
                  return (
                    <li key={pid} className="flex justify-between text-sm font-black">
                      <span className="truncate">{p ? formatProductName(p) : pid}</span>
                      <span className="tabular-nums">{total}</span>
                    </li>
                  );
                })}
            </ul>
            {Object.keys(totalsByProduct).length === 0 ? (
              <p className="text-sm text-black/60">Keine Mengen.</p>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
