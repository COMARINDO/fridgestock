"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { getAiToggle } from "@/lib/getAiToggle";
import {
  getWeeklyUsageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOrderOverrides,
  listProducts,
  upsertOrderOverride,
} from "@/lib/db";
import {
  computeCentralWarehouseOrder,
  computeLocalOutletOrder,
} from "@/lib/orderSuggestions";
import {
  HOFSTETTEN_NAME,
  KIRCHBERG_NAME,
  RABENSTEIN_LAGER_NAME,
  TEICH_NAME,
} from "@/lib/locationConstants";
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

type TabId = "central" | "hofstetten" | "kirchberg" | "gesamt";

type CentralRowModel = {
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

type LocalOutletRowModel = {
  productId: string;
  name: string;
  stock: number;
  usage7d: number;
  calculatedOrder: number;
  displayOrder: number;
  overridden: boolean;
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const { isAdmin, exitAdmin, adminHydrated } = useAdmin();

  const [useAi, setUseAi] = useState(false);
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
  const [activeTab, setActiveTab] = useState<TabId>("central");

  const [editing, setEditing] = useState<{
    locationId: string;
    productId: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const rabensteinId = useMemo(
    () => resolveLocationIdByName(locations, RABENSTEIN_LAGER_NAME),
    [locations]
  );
  const teichId = useMemo(
    () => resolveLocationIdByName(locations, TEICH_NAME),
    [locations]
  );
  const hofstettenId = useMemo(
    () => resolveLocationIdByName(locations, HOFSTETTEN_NAME),
    [locations]
  );
  const kirchbergId = useMemo(
    () => resolveLocationIdByName(locations, KIRCHBERG_NAME),
    [locations]
  );

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  useEffect(() => {
    try {
      setUseAi(getAiToggle());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("useAiConsumption.v1", useAi ? "true" : "false");
    } catch {
      // ignore
    }
  }, [useAi]);

  const reload = useCallback(async () => {
    setErr(null);
    const [locs, prods, usage, invAll, ovs] = await Promise.all([
      listLocations(),
      listProducts(),
      getWeeklyUsageByLocationProduct({ days: 7, useAi }),
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
  }, [useAi]);

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
    if (!rabensteinId) return [] as CentralRowModel[];
    const list: CentralRowModel[] = [];
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

  const hofstettenRows = useMemo(() => {
    if (!hofstettenId) return [] as LocalOutletRowModel[];
    const list: LocalOutletRowModel[] = [];
    for (const p of products) {
      const usage = Math.max(
        0,
        Math.round(usageByLoc[hofstettenId]?.[p.id] ?? 0)
      );
      const stock = inventoryQty[hofstettenId]?.[p.id] ?? 0;
      const { orderQuantity: calculatedOrder } = computeLocalOutletOrder({
        usage7d: usage,
        stock,
      });
      const ov = overrideByKey.get(`${hofstettenId}:${p.id}`);
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
        stock,
        usage7d: usage,
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
    hofstettenId,
  ]);

  const kirchbergRows = useMemo(() => {
    if (!kirchbergId) return [] as LocalOutletRowModel[];
    const list: LocalOutletRowModel[] = [];
    for (const p of products) {
      const usage = Math.max(
        0,
        Math.round(usageByLoc[kirchbergId]?.[p.id] ?? 0)
      );
      const stock = inventoryQty[kirchbergId]?.[p.id] ?? 0;
      const { orderQuantity: calculatedOrder } = computeLocalOutletOrder({
        usage7d: usage,
        stock,
      });
      const ov = overrideByKey.get(`${kirchbergId}:${p.id}`);
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
        stock,
        usage7d: usage,
        calculatedOrder,
        displayOrder,
        overridden,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return list;
  }, [products, usageByLoc, inventoryQty, overrideByKey, kirchbergId]);

  const gesamtRows = useMemo(() => {
    const byId = new Map<
      string,
      {
        name: string;
        rabenstein: number;
        hofstetten: number;
        kirchberg: number;
      }
    >();

    for (const r of centralRows) {
      const cur = byId.get(r.productId) ?? {
        name: r.name,
        rabenstein: 0,
        hofstetten: 0,
        kirchberg: 0,
      };
      cur.name = r.name;
      cur.rabenstein = r.displayOrder;
      byId.set(r.productId, cur);
    }
    for (const r of hofstettenRows) {
      const cur = byId.get(r.productId) ?? {
        name: r.name,
        rabenstein: 0,
        hofstetten: 0,
        kirchberg: 0,
      };
      cur.name = r.name;
      cur.hofstetten = r.displayOrder;
      byId.set(r.productId, cur);
    }
    for (const r of kirchbergRows) {
      const cur = byId.get(r.productId) ?? {
        name: r.name,
        rabenstein: 0,
        hofstetten: 0,
        kirchberg: 0,
      };
      cur.name = r.name;
      cur.kirchberg = r.displayOrder;
      byId.set(r.productId, cur);
    }

    const out = Array.from(byId.entries()).map(([productId, v]) => ({
      productId,
      name: v.name,
      rabenstein: v.rabenstein,
      hofstetten: v.hofstetten,
      kirchberg: v.kirchberg,
      sum: v.rabenstein + v.hofstetten + v.kirchberg,
    }));
    out.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return out;
  }, [centralRows, hofstettenRows, kirchbergRows]);

  const sumCentral = useMemo(
    () => centralRows.reduce((s, r) => s + r.displayOrder, 0),
    [centralRows]
  );
  const sumHof = useMemo(
    () => hofstettenRows.reduce((s, r) => s + r.displayOrder, 0),
    [hofstettenRows]
  );
  const sumKir = useMemo(
    () => kirchbergRows.reduce((s, r) => s + r.displayOrder, 0),
    [kirchbergRows]
  );
  const sumGesamt = useMemo(
    () => gesamtRows.reduce((s, r) => s + r.sum, 0),
    [gesamtRows]
  );

  async function saveEdit() {
    if (!editing) return;
    const n = Math.max(0, Math.floor(Number(editDraft.replace(/[^\d]/g, "")) || 0));
    setSaveBusy(true);
    setErr(null);
    try {
      await upsertOrderOverride({
        locationId: editing.locationId,
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

  const tabBtn =
    "h-11 px-3 sm:px-4 rounded-2xl border-2 text-sm font-black whitespace-nowrap shrink-0 transition-colors";
  const tabBtnActive = "border-black bg-black text-white";
  const tabBtnIdle = "border-black bg-white text-black active:scale-[0.99]";

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
            <strong>{RABENSTEIN_LAGER_NAME}</strong> mit {TEICH_NAME}: zentrales Lager;{" "}
            <strong>{HOFSTETTEN_NAME}</strong> und <strong>{KIRCHBERG_NAME}</strong>: je
            Platzerl Verbrauch 7d minus lokaler Bestand. Reiter{" "}
            <strong>Gesamt</strong>: Summen pro Produkt.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={[
                "h-10 px-3 rounded-2xl border-2 text-sm font-black transition-colors active:scale-[0.99]",
                useAi ? "border-emerald-800 bg-emerald-700 text-white" : "border-black bg-white text-black",
              ].join(" ")}
              onClick={() => setUseAi((v) => !v)}
              title="KI-Prognose an/aus"
            >
              {useAi ? "KI Prognose aktiv" : "Klassische Berechnung"}
            </button>
            <span className="text-xs font-black text-black/50">
              (Fallback: wenn keine KI-Daten vorhanden sind, wird klassisch gerechnet)
            </span>
          </div>
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

      {!busy && !err ? (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            className={`${tabBtn} ${activeTab === "central" ? tabBtnActive : tabBtnIdle}`}
            onClick={() => setActiveTab("central")}
          >
            {RABENSTEIN_LAGER_NAME} + {TEICH_NAME}
          </button>
          <button
            type="button"
            className={`${tabBtn} ${activeTab === "hofstetten" ? tabBtnActive : tabBtnIdle}`}
            onClick={() => setActiveTab("hofstetten")}
          >
            {HOFSTETTEN_NAME}
          </button>
          <button
            type="button"
            className={`${tabBtn} ${activeTab === "kirchberg" ? tabBtnActive : tabBtnIdle}`}
            onClick={() => setActiveTab("kirchberg")}
          >
            {KIRCHBERG_NAME}
          </button>
          <button
            type="button"
            className={`${tabBtn} ${activeTab === "gesamt" ? tabBtnActive : tabBtnIdle}`}
            onClick={() => setActiveTab("gesamt")}
          >
            Gesamt
          </button>
        </div>
      ) : null}

      {!rabensteinId && !busy && !err ? (
        <div className="mt-6 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{RABENSTEIN_LAGER_NAME}“ nicht gefunden. Bitte Namen in den Orten prüfen.
        </div>
      ) : null}

      {!teichId && !busy && !err && rabensteinId && activeTab === "central" ? (
        <div className="mt-4 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{TEICH_NAME}“ nicht gefunden — Teich-Verbrauch wird als 0 gezählt.
        </div>
      ) : null}

      {!hofstettenId && !busy && !err && activeTab === "hofstetten" ? (
        <div className="mt-4 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{HOFSTETTEN_NAME}“ nicht gefunden.
        </div>
      ) : null}

      {!kirchbergId && !busy && !err && activeTab === "kirchberg" ? (
        <div className="mt-4 rounded-3xl bg-amber-50 border-2 border-amber-800/30 p-4 text-amber-950 text-sm font-black">
          Platzerl „{KIRCHBERG_NAME}“ nicht gefunden.
        </div>
      ) : null}

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err && activeTab === "central" && rabensteinId ? (
        <>
          <section className="mt-8 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_LAGER_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">Bestand</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {TEICH_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">7d</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_LAGER_NAME}
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
                  const isEd =
                    editing?.productId === r.productId &&
                    editing?.locationId === rabensteinId;
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
                              setEditing({
                                locationId: rabensteinId,
                                productId: r.productId,
                              });
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
            Summe ({RABENSTEIN_LAGER_NAME}): {sumCentral}
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "hofstetten" && hofstettenId ? (
        <>
          <section className="mt-8 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">Bestand</th>
                  <th className="p-3 font-black text-black tabular-nums">Verbrauch 7d</th>
                  <th className="p-3 font-black text-black tabular-nums">Bestellen</th>
                </tr>
              </thead>
              <tbody>
                {hofstettenRows.map((r) => {
                  const isEd =
                    editing?.productId === r.productId &&
                    editing?.locationId === hofstettenId;
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
                      <td className="p-3 font-black tabular-nums">{r.stock}</td>
                      <td className="p-3 font-black tabular-nums">{r.usage7d}</td>
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
                              setEditing({
                                locationId: hofstettenId,
                                productId: r.productId,
                              });
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
            {hofstettenRows.length === 0 ? (
              <p className="p-4 text-sm text-black/60 font-black">Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-4 flex justify-end text-sm font-black text-black">
            Summe ({HOFSTETTEN_NAME}): {sumHof}
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "kirchberg" && kirchbergId ? (
        <>
          <section className="mt-8 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">Bestand</th>
                  <th className="p-3 font-black text-black tabular-nums">Verbrauch 7d</th>
                  <th className="p-3 font-black text-black tabular-nums">Bestellen</th>
                </tr>
              </thead>
              <tbody>
                {kirchbergRows.map((r) => {
                  const isEd =
                    editing?.productId === r.productId &&
                    editing?.locationId === kirchbergId;
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
                      <td className="p-3 font-black tabular-nums">{r.stock}</td>
                      <td className="p-3 font-black tabular-nums">{r.usage7d}</td>
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
                              setEditing({
                                locationId: kirchbergId,
                                productId: r.productId,
                              });
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
            {kirchbergRows.length === 0 ? (
              <p className="p-4 text-sm text-black/60 font-black">Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-4 flex justify-end text-sm font-black text-black">
            Summe ({KIRCHBERG_NAME}): {sumKir}
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "gesamt" ? (
        <>
          <p className="mt-6 text-xs font-black text-black/55">
            Übersicht aller Bestellvorschläge; Bearbeitung in den jeweiligen Reitern.
          </p>
          <section className="mt-3 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_LAGER_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">+ {TEICH_NAME}</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">{HOFSTETTEN_NAME}</th>
                  <th className="p-3 font-black text-black tabular-nums">{KIRCHBERG_NAME}</th>
                  <th className="p-3 font-black text-black tabular-nums">Summe</th>
                </tr>
              </thead>
              <tbody>
                {gesamtRows.map((r) => (
                  <tr key={r.productId} className="border-b border-black/10 align-middle">
                    <td className="p-3 font-black text-black max-w-[200px] truncate">
                      {r.name}
                    </td>
                    <td className="p-3 font-black tabular-nums">{r.rabenstein}</td>
                    <td className="p-3 font-black tabular-nums">{r.hofstetten}</td>
                    <td className="p-3 font-black tabular-nums">{r.kirchberg}</td>
                    <td className="p-3 font-black tabular-nums">{r.sum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gesamtRows.length === 0 ? (
              <p className="p-4 text-sm text-black/60 font-black">Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-4 flex flex-wrap justify-end gap-4 text-sm font-black text-black">
            <span>
              Σ {RABENSTEIN_LAGER_NAME}: {sumCentral}
            </span>
            <span>
              Σ {HOFSTETTEN_NAME}: {sumHof}
            </span>
            <span>
              Σ {KIRCHBERG_NAME}: {sumKir}
            </span>
            <span className="border-l-2 border-black/20 pl-4">Gesamt: {sumGesamt}</span>
          </div>
        </>
      ) : null}
    </main>
  );
}
