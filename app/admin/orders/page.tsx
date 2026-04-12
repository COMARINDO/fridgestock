"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  getWeeklyUsageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOrderOverrides,
  listProducts,
  upsertOrderOverride,
} from "@/lib/db";
import { computeCentralWarehouseOrder } from "@/lib/orderSuggestions";
import { RABENSTEIN_NAME, TEICH_NAME } from "@/lib/locationConstants";
import type { Location, OrderOverrideRow, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";

function resolveLocationIdByName(
  locations: Location[],
  name: string
): string | null {
  const n = name.trim().toLowerCase();
  const hit = locations.find((l) => l.name.trim().toLowerCase() === n);
  return hit?.id ?? null;
}

type RowModel = {
  productId: string;
  name: string;
  stockRabenstein: number;
  stockTeich: number;
  usageTeich7d: number;
  usageRabenstein7d: number;
  totalUsage7d: number;
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
  const [overrides, setOverrides] = useState<OrderOverrideRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ productId: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const rabensteinId = useMemo(
    () => resolveLocationIdByName(locations, RABENSTEIN_NAME),
    [locations]
  );
  const teichId = useMemo(
    () => resolveLocationIdByName(locations, TEICH_NAME),
    [locations]
  );

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

    setLocations(locs);
    setProducts(prods);
    setUsageByLoc(usage);
    setInventoryQty(invMap);
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

  const centralRows = useMemo(() => {
    if (!rabensteinId) return [] as RowModel[];
    const list: RowModel[] = [];
    const tId = teichId;

    for (const p of products) {
      const usageTeich = Math.max(
        0,
        Math.round(tId ? (usageByLoc[tId]?.[p.id] ?? 0) : 0)
      );
      const usageRab = Math.max(
        0,
        Math.round(usageByLoc[rabensteinId]?.[p.id] ?? 0)
      );
      const stockRab = inventoryQty[rabensteinId]?.[p.id] ?? 0;
      const stockTeich = tId ? (inventoryQty[tId]?.[p.id] ?? 0) : 0;

      const { totalUsage7d, orderQuantity: calculatedOrder } =
        computeCentralWarehouseOrder({
          usageTeich7d: usageTeich,
          usageRabenstein7d: usageRab,
          stockRabenstein: stockRab,
        });

      const ov = overrideByKey.get(`${rabensteinId}:${p.id}`);
      const overridden = ov !== undefined;
      const displayOrder = overridden ? ov!.quantity : calculatedOrder;

      const include =
        usageTeich > 0 ||
        usageRab > 0 ||
        stockRab > 0 ||
        stockTeich > 0 ||
        overridden ||
        calculatedOrder > 0 ||
        displayOrder > 0;
      if (!include) continue;

      list.push({
        productId: p.id,
        name: formatProductName(p),
        stockRabenstein: stockRab,
        stockTeich,
        usageTeich7d: usageTeich,
        usageRabenstein7d: usageRab,
        totalUsage7d,
        calculatedOrder,
        displayOrder,
        overridden,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return list;
  }, [
    products,
    usageByLoc,
    inventoryQty,
    overrideByKey,
    rabensteinId,
    teichId,
  ]);

  const orderSum = useMemo(
    () => centralRows.reduce((s, r) => s + r.displayOrder, 0),
    [centralRows]
  );

  async function saveEdit() {
    if (!editing || !rabensteinId) return;
    const n = Math.max(0, Math.floor(Number(editDraft.replace(/[^\d]/g, "")) || 0));
    setSaveBusy(true);
    setErr(null);
    try {
      await upsertOrderOverride({
        locationId: rabensteinId,
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
            Zentrale Bestellung nur für <strong>{RABENSTEIN_NAME}</strong> (Lager).
            Nachfrage = Verbrauch {TEICH_NAME} + Verbrauch {RABENSTEIN_NAME} (7 Tage);
            Bestand nur {RABENSTEIN_NAME}. {TEICH_NAME}-Bestand wird nur angezeigt.
            Transfers zählen nicht als Verbrauch.
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

      {!rabensteinId && !busy && !err ? (
        <div className="mt-6 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{RABENSTEIN_NAME}“ nicht gefunden. Bitte Namen in den
          Orten prüfen.
        </div>
      ) : null}

      {!teichId && !busy && !err && rabensteinId ? (
        <div className="mt-4 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{TEICH_NAME}“ nicht gefunden — Teich-Verbrauch wird als 0
          gezählt.
        </div>
      ) : null}

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err && rabensteinId ? (
        <>
          <section className="mt-8 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">Bestand</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {TEICH_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">7d</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">7d</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {TEICH_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">Bestand</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">Bestellen</th>
                </tr>
              </thead>
              <tbody>
                {centralRows.map((r) => {
                  const isEd = editing?.productId === r.productId;
                  return (
                    <tr key={r.productId} className="border-b border-black/10 align-middle">
                      <td className="p-3 font-black text-black max-w-[200px]">
                        <div className="truncate">{r.name}</div>
                        {r.overridden ? (
                          <div className="text-[11px] font-black text-amber-800">
                            Manuell (Vorschlag: {r.calculatedOrder})
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.stockRabenstein}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.usageTeich7d}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.usageRabenstein7d}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black/80">
                        {r.stockTeich}
                      </td>
                      <td className="p-3">
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
                              setEditing({ productId: r.productId });
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {centralRows.length === 0 ? (
              <p className="p-4 text-sm text-black/60 font-black">Keine Positionen.</p>
            ) : null}
          </section>

          <div className="mt-4 flex justify-end text-sm font-black text-black">
            Summe Bestellung ({RABENSTEIN_NAME}): {orderSum}
          </div>

          <section className="mt-10 rounded-3xl border-2 border-dashed border-black/25 bg-white p-4">
            <h2 className="text-sm font-black text-black/70">Weitere Platzerl</h2>
            <p className="mt-1 text-xs text-black/55">
              Nur zur Übersicht — Bestellmengen gelten nur für {RABENSTEIN_NAME}.
            </p>
            <ul className="mt-3 space-y-1 text-sm font-black text-black/70">
              {locations
                .filter((l) => l.id !== rabensteinId && l.id !== teichId)
                .sort((a, b) => a.name.localeCompare(b.name, "de"))
                .map((loc) => (
                  <li key={loc.id}>
                    {loc.name} — Verbrauch 7d wird nicht in die zentrale Bestellung
                    einbezogen.
                  </li>
                ))}
              {locations.filter((l) => l.id !== rabensteinId && l.id !== teichId)
                .length === 0 ? (
                <li className="text-black/45">Keine weiteren Orte.</li>
              ) : null}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
