"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { getAiToggle } from "@/lib/getAiToggle";
import {
  getWeeklyUsageWithCoverageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOrderOverrides,
  listProducts,
  updateProduct,
  updateProductMetroData,
  upsertOrderOverride,
} from "@/lib/db";
import {
  computeCentralWarehouseOrder,
  computeLocalOutletOrder,
} from "@/lib/orderSuggestions";
import {
  HOFSTETTEN_NAME,
  KIRCHBERG_NAME,
  RABENSTEIN_FILIALE_NAME,
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
  metro_order_number: string | null;
  metro_unit: string | null;
  stockRabenstein: number;
  stockTeich: number;
  stockFiliale: number;
  usageTeich7d: number;
  usageFiliale7d: number;
  totalUsage7d: number;
  calculatedOrder: number;
  displayOrder: number;
  overridden: boolean;
};

type LocalOutletRowModel = {
  productId: string;
  name: string;
  metro_order_number: string | null;
  metro_unit: string | null;
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
  const [daysCoveredByLoc, setDaysCoveredByLoc] = useState<
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
  const [metroEditing, setMetroEditing] = useState<{
    productId: string;
    field: "metro_order_number" | "metro_unit";
  } | null>(null);
  const [metroDraft, setMetroDraft] = useState("");
  const [metroSaveBusy, setMetroSaveBusy] = useState(false);
  const [productEditing, setProductEditing] = useState<{
    productId: string;
    field: "name" | "zusatz";
  } | null>(null);
  const [productDraft, setProductDraft] = useState("");
  const [productSaveBusy, setProductSaveBusy] = useState(false);

  const rabensteinId = useMemo(
    () => resolveLocationIdByName(locations, RABENSTEIN_LAGER_NAME),
    [locations]
  );
  const teichId = useMemo(
    () => resolveLocationIdByName(locations, TEICH_NAME),
    [locations]
  );
  const filialeId = useMemo(
    () => resolveLocationIdByName(locations, RABENSTEIN_FILIALE_NAME),
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
    const [locs, prods, usageMeta, invAll, ovs] = await Promise.all([
      listLocations(),
      listProducts(),
      getWeeklyUsageWithCoverageByLocationProduct({ days: 7, useAi }),
      listInventoryAll(),
      listOrderOverrides(),
    ]);

    const invMap: Record<string, Record<string, number>> = {};
    for (const row of invAll) {
      if (!invMap[row.location_id]) invMap[row.location_id] = {};
      invMap[row.location_id][row.product_id] = Math.floor(Number(row.quantity) || 0);
    }

    setLocations(locs);
    setProducts(prods);
    setUsageByLoc(usageMeta.usageByLoc);
    setDaysCoveredByLoc(usageMeta.daysCoveredByLoc);
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
    const fId = filialeId;

    for (const p of products) {
      const usageTeich = Math.max(
        0,
        Math.round(tId ? (usageByLoc[tId]?.[p.id] ?? 0) : 0)
      );
      const usageFiliale = Math.max(
        0,
        Math.round(fId ? (usageByLoc[fId]?.[p.id] ?? 0) : 0)
      );
      const stockRab = inventoryQty[rabensteinId]?.[p.id] ?? 0;
      const stockTeich = tId ? (inventoryQty[tId]?.[p.id] ?? 0) : 0;
      const stockFiliale = fId ? (inventoryQty[fId]?.[p.id] ?? 0) : 0;

      const { totalUsage7d, orderQuantity: calculatedOrder } =
        computeCentralWarehouseOrder({
          usageTeich7d: usageTeich,
          usageFiliale7d: usageFiliale,
          daysCoveredTeich: tId ? (daysCoveredByLoc[tId]?.[p.id] ?? 0) : 0,
          daysCoveredFiliale: fId ? (daysCoveredByLoc[fId]?.[p.id] ?? 0) : 0,
          stockRabenstein: stockRab,
          stockTeich,
        });

      const ov = overrideByKey.get(`${rabensteinId}:${p.id}`);
      const overridden = ov !== undefined;
      const displayOrder = overridden ? ov!.quantity : calculatedOrder;

      const include =
        usageTeich > 0 ||
        usageFiliale > 0 ||
        stockRab > 0 ||
        stockTeich > 0 ||
        stockFiliale > 0 ||
        overridden ||
        calculatedOrder > 0 ||
        displayOrder > 0;
      if (!include) continue;

      list.push({
        productId: p.id,
        name: formatProductName(p),
        metro_order_number: p.metro_order_number ?? null,
        metro_unit: p.metro_unit ?? null,
        stockRabenstein: stockRab,
        stockTeich,
        stockFiliale,
        usageTeich7d: usageTeich,
        usageFiliale7d: usageFiliale,
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
    daysCoveredByLoc,
    inventoryQty,
    overrideByKey,
    rabensteinId,
    teichId,
    filialeId,
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
        daysCovered: daysCoveredByLoc[hofstettenId]?.[p.id] ?? 0,
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
        metro_order_number: p.metro_order_number ?? null,
        metro_unit: p.metro_unit ?? null,
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
    daysCoveredByLoc,
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
        daysCovered: daysCoveredByLoc[kirchbergId]?.[p.id] ?? 0,
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
        metro_order_number: p.metro_order_number ?? null,
        metro_unit: p.metro_unit ?? null,
        stock,
        usage7d: usage,
        calculatedOrder,
        displayOrder,
        overridden,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return list;
  }, [products, usageByLoc, daysCoveredByLoc, inventoryQty, overrideByKey, kirchbergId]);

  const gesamtRows = useMemo(() => {
    // Show ALL products, with ordering totals.
    const out: Array<{
      productId: string;
      name: string;
      zusatz: string | null;
      metro_order_number: string | null;
      metro_unit: string | null;
      rabenstein: number;
      hofstetten: number;
      kirchberg: number;
      sum: number;
    }> = [];

    for (const p of products) {
      const brand = (p.brand ?? "").trim();
      const pname = (p.product_name ?? "").trim();
      const name = [brand, pname].filter(Boolean).join(" - ");

      // Central (lager): demand = Teich + Filiale + Lager usage; stock = Lager stock
      let central = 0;
      if (rabensteinId) {
        const tId = teichId;
        const fId = filialeId;
        const usageTeich = Math.max(0, Math.round(tId ? (usageByLoc[tId]?.[p.id] ?? 0) : 0));
        const usageFiliale = Math.max(
          0,
          Math.round(fId ? (usageByLoc[fId]?.[p.id] ?? 0) : 0)
        );
        const stockRab = inventoryQty[rabensteinId]?.[p.id] ?? 0;
        const stockTeich = tId ? (inventoryQty[tId]?.[p.id] ?? 0) : 0;
        const { orderQuantity } = computeCentralWarehouseOrder({
          usageTeich7d: usageTeich,
          usageFiliale7d: usageFiliale,
          daysCoveredTeich: tId ? (daysCoveredByLoc[tId]?.[p.id] ?? 0) : 0,
          daysCoveredFiliale: fId ? (daysCoveredByLoc[fId]?.[p.id] ?? 0) : 0,
          stockRabenstein: stockRab,
          stockTeich,
        });
        const ov = overrideByKey.get(`${rabensteinId}:${p.id}`);
        central = ov ? ov.quantity : orderQuantity;
      }

      // Local outlets
      let hof = 0;
      if (hofstettenId) {
        const usage = Math.max(0, Math.round(usageByLoc[hofstettenId]?.[p.id] ?? 0));
        const stock = inventoryQty[hofstettenId]?.[p.id] ?? 0;
        const { orderQuantity } = computeLocalOutletOrder({
          usage7d: usage,
          stock,
          daysCovered: daysCoveredByLoc[hofstettenId]?.[p.id] ?? 0,
        });
        const ov = overrideByKey.get(`${hofstettenId}:${p.id}`);
        hof = ov ? ov.quantity : orderQuantity;
      }

      let kir = 0;
      if (kirchbergId) {
        const usage = Math.max(0, Math.round(usageByLoc[kirchbergId]?.[p.id] ?? 0));
        const stock = inventoryQty[kirchbergId]?.[p.id] ?? 0;
        const { orderQuantity } = computeLocalOutletOrder({
          usage7d: usage,
          stock,
          daysCovered: daysCoveredByLoc[kirchbergId]?.[p.id] ?? 0,
        });
        const ov = overrideByKey.get(`${kirchbergId}:${p.id}`);
        kir = ov ? ov.quantity : orderQuantity;
      }

      const sum = central + hof + kir;
      out.push({
        productId: p.id,
        name,
        zusatz: p.zusatz ?? null,
        metro_order_number: p.metro_order_number ?? null,
        metro_unit: p.metro_unit ?? null,
        rabenstein: central,
        hofstetten: hof,
        kirchberg: kir,
        sum,
      });
    }

    out.sort((a, b) => {
      const ao = a.sum > 0 ? 0 : 1;
      const bo = b.sum > 0 ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, "de");
    });
    return out;
  }, [
    products,
    rabensteinId,
    teichId,
    filialeId,
    hofstettenId,
    kirchbergId,
    usageByLoc,
    daysCoveredByLoc,
    inventoryQty,
    overrideByKey,
  ]);

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

  async function saveMetroEdit() {
    if (!metroEditing) return;
    setMetroSaveBusy(true);
    setErr(null);
    const productId = metroEditing.productId;
    const value = metroDraft.trim() ? metroDraft.trim() : null;
    const prev = products.find((p) => p.id === productId) ?? null;
    const nextNumber =
      metroEditing.field === "metro_order_number"
        ? value
        : (prev?.metro_order_number ?? null);
    const nextUnit =
      metroEditing.field === "metro_unit" ? value : (prev?.metro_unit ?? null);

    // Optimistic UI update
    setProducts((cur) =>
      cur.map((p) =>
        p.id === productId
          ? {
              ...p,
              metro_order_number: nextNumber,
              metro_unit: nextUnit,
            }
          : p
      )
    );

    try {
      await updateProductMetroData(productId, {
        metro_order_number: nextNumber,
        metro_unit: nextUnit,
      });
      setMetroEditing(null);
    } catch (e: unknown) {
      // rollback to previous values
      setProducts((cur) =>
        cur.map((p) =>
          p.id === productId
            ? {
                ...p,
                metro_order_number: prev?.metro_order_number ?? null,
                metro_unit: prev?.metro_unit ?? null,
              }
            : p
        )
      );
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setMetroSaveBusy(false);
    }
  }

  async function saveProductEdit() {
    if (!productEditing) return;
    setProductSaveBusy(true);
    setErr(null);

    const productId = productEditing.productId;
    const prev = products.find((p) => p.id === productId) ?? null;
    if (!prev) {
      setProductEditing(null);
      setProductSaveBusy(false);
      return;
    }

    const raw = productDraft.trim();

    let nextBrand = (prev.brand ?? "").trim();
    let nextName = (prev.product_name ?? "").trim();
    let nextZusatz = prev.zusatz ?? null;

    if (productEditing.field === "zusatz") {
      nextZusatz = raw ? raw : null;
    } else {
      // Edit "Product Name" as: "Brand - Name" (fallback: keep brand, change name)
      const parts = raw.split("-").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        nextBrand = parts[0] ?? nextBrand;
        nextName = parts.slice(1).join(" - ") || nextName;
      } else if (parts.length === 1) {
        nextName = parts[0] ?? nextName;
      }
      if (!nextBrand) nextBrand = prev.brand ?? "";
      if (!nextName) nextName = prev.product_name ?? "";
    }

    // Optimistic UI update
    setProducts((cur) =>
      cur.map((p) =>
        p.id === productId
          ? {
              ...p,
              brand: nextBrand,
              product_name: nextName,
              zusatz: nextZusatz,
            }
          : p
      )
    );

    try {
      await updateProduct({
        productId,
        brand: nextBrand,
        product_name: nextName,
        zusatz: nextZusatz,
        barcode: prev.barcode ?? null,
        short_name: prev.short_name ?? null,
        min_quantity: prev.min_quantity ?? null,
      });
      setProductEditing(null);
    } catch (e: unknown) {
      // rollback
      setProducts((cur) =>
        cur.map((p) => (p.id === productId ? prev : p))
      );
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setProductSaveBusy(false);
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
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black">Metro Nr</th>
                  <th className="p-3 font-black text-black">Einheit</th>
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
                    {RABENSTEIN_FILIALE_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">7d</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {TEICH_NAME}
                    <br />
                    <span className="text-[11px] font-black text-black/55">Bestand</span>
                  </th>
                  <th className="p-3 font-black text-black tabular-nums">
                    {RABENSTEIN_FILIALE_NAME}
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
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
                      <td className="p-3">
                        {editMetroNr ? (
                          <input
                            className="h-10 w-28 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Nummer"
                          />
                        ) : (
                          <button
                            type="button"
                            className={[
                              "h-10 min-w-[7rem] rounded-xl border-2 px-2 text-sm font-black text-left",
                              r.metro_order_number
                                ? "border-black bg-white text-black"
                                : "border-red-800 bg-red-50 text-red-900",
                            ].join(" ")}
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_order_number" });
                              setMetroDraft(r.metro_order_number ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            {r.metro_order_number?.trim() ? r.metro_order_number : "–"}
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {editMetroUnit ? (
                          <input
                            className="h-10 w-24 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Einheit"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 min-w-[5.5rem] rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black"
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_unit" });
                              setMetroDraft(r.metro_unit ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            {r.metro_unit?.trim() ? r.metro_unit : "–"}
                          </button>
                        )}
                      </td>
                      <td
                        className={[
                          "p-3 font-black tabular-nums",
                          r.stockRabenstein < 0 ? "text-red-800" : "text-black",
                        ].join(" ")}
                      >
                        {r.stockRabenstein}
                        {r.stockRabenstein < 0 ? (
                          <span className="ml-2 text-[11px] font-black text-red-800/80">
                            Backorder
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.usageTeich7d}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.usageFiliale7d}
                      </td>
                      <td
                        className={[
                          "p-3 font-black tabular-nums",
                          r.stockTeich < 0 ? "text-red-800" : "text-black/80",
                        ].join(" ")}
                      >
                        {r.stockTeich}
                        {r.stockTeich < 0 ? (
                          <span className="ml-2 text-[11px] font-black text-red-800/80">
                            Backorder
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={[
                          "p-3 font-black tabular-nums",
                          r.stockFiliale < 0 ? "text-red-800" : "text-black/80",
                        ].join(" ")}
                      >
                        {r.stockFiliale}
                        {r.stockFiliale < 0 ? (
                          <span className="ml-2 text-[11px] font-black text-red-800/80">
                            Backorder
                          </span>
                        ) : null}
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
                  <th className="p-3 font-black text-black">Metro Nr</th>
                  <th className="p-3 font-black text-black">Einheit</th>
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
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
                      <td className="p-3">
                        {editMetroNr ? (
                          <input
                            className="h-10 w-28 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Nummer"
                          />
                        ) : (
                          <button
                            type="button"
                            className={[
                              "h-10 min-w-[7rem] rounded-xl border-2 px-2 text-sm font-black text-left",
                              r.metro_order_number
                                ? "border-black bg-white text-black"
                                : "border-red-800 bg-red-50 text-red-900",
                            ].join(" ")}
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_order_number" });
                              setMetroDraft(r.metro_order_number ?? "");
                            }}
                          >
                            {r.metro_order_number?.trim() ? r.metro_order_number : "–"}
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {editMetroUnit ? (
                          <input
                            className="h-10 w-24 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Einheit"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 min-w-[5.5rem] rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black"
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_unit" });
                              setMetroDraft(r.metro_unit ?? "");
                            }}
                          >
                            {r.metro_unit?.trim() ? r.metro_unit : "–"}
                          </button>
                        )}
                      </td>
                      <td
                        className={[
                          "p-3 font-black tabular-nums",
                          r.stock < 0 ? "text-red-800" : "text-black",
                        ].join(" ")}
                      >
                        {r.stock}
                        {r.stock < 0 ? (
                          <span className="ml-2 text-[11px] font-black text-red-800/80">
                            Backorder
                          </span>
                        ) : null}
                      </td>
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
                  <th className="p-3 font-black text-black">Metro Nr</th>
                  <th className="p-3 font-black text-black">Einheit</th>
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
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
                      <td className="p-3">
                        {editMetroNr ? (
                          <input
                            className="h-10 w-28 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Nummer"
                          />
                        ) : (
                          <button
                            type="button"
                            className={[
                              "h-10 min-w-[7rem] rounded-xl border-2 px-2 text-sm font-black text-left",
                              r.metro_order_number
                                ? "border-black bg-white text-black"
                                : "border-red-800 bg-red-50 text-red-900",
                            ].join(" ")}
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_order_number" });
                              setMetroDraft(r.metro_order_number ?? "");
                            }}
                          >
                            {r.metro_order_number?.trim() ? r.metro_order_number : "–"}
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {editMetroUnit ? (
                          <input
                            className="h-10 w-24 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Einheit"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 min-w-[5.5rem] rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black"
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_unit" });
                              setMetroDraft(r.metro_unit ?? "");
                            }}
                          >
                            {r.metro_unit?.trim() ? r.metro_unit : "–"}
                          </button>
                        )}
                      </td>
                      <td
                        className={[
                          "p-3 font-black tabular-nums",
                          r.stock < 0 ? "text-red-800" : "text-black",
                        ].join(" ")}
                      >
                        {r.stock}
                        {r.stock < 0 ? (
                          <span className="ml-2 text-[11px] font-black text-red-800/80">
                            Backorder
                          </span>
                        ) : null}
                      </td>
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
            Alle Produkte; Bestellung ist die Summe aus zentral + Hofstetten + Kirchberg.
          </p>
          <section className="mt-3 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black">Zusatz</th>
                  <th className="p-3 font-black text-black">Metro Nr</th>
                  <th className="p-3 font-black text-black">Einheit</th>
                  <th className="p-3 font-black text-black tabular-nums">Bestellung</th>
                </tr>
              </thead>
              <tbody>
                {gesamtRows.map((r) => {
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
                  const editName =
                    productEditing?.productId === r.productId &&
                    productEditing?.field === "name";
                  const editZusatz =
                    productEditing?.productId === r.productId &&
                    productEditing?.field === "zusatz";
                  return (
                    <tr key={r.productId} className="border-b border-black/10 align-middle">
                      <td className="p-3 font-black text-black max-w-[220px]">
                        {editName ? (
                          <input
                            className="h-10 w-full min-w-[12rem] rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={productDraft}
                            autoFocus
                            onChange={(e) => setProductDraft(e.target.value)}
                            onBlur={() => void saveProductEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveProductEdit();
                              if (e.key === "Escape") setProductEditing(null);
                            }}
                            disabled={productSaveBusy}
                            aria-label="Produktname"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 w-full rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black"
                            onClick={() => {
                              setProductEditing({ productId: r.productId, field: "name" });
                              setProductDraft(r.name ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            <div className="truncate">{r.name || "-"}</div>
                          </button>
                        )}
                      </td>
                      <td className="p-3 font-black text-black/70 max-w-[120px] truncate">
                        {editZusatz ? (
                          <input
                            className="h-10 w-full min-w-[7rem] rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={productDraft}
                            autoFocus
                            onChange={(e) => setProductDraft(e.target.value)}
                            onBlur={() => void saveProductEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveProductEdit();
                              if (e.key === "Escape") setProductEditing(null);
                            }}
                            disabled={productSaveBusy}
                            aria-label="Zusatz"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 w-full rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black/80"
                            onClick={() => {
                              setProductEditing({ productId: r.productId, field: "zusatz" });
                              setProductDraft(r.zusatz ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            <div className="truncate">{r.zusatz?.trim() ? r.zusatz : "-"}</div>
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {editMetroNr ? (
                          <input
                            className="h-10 w-28 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Nummer"
                          />
                        ) : (
                          <button
                            type="button"
                            className={[
                              "h-10 min-w-[7rem] rounded-xl border-2 px-2 text-sm font-black text-left",
                              r.metro_order_number?.trim()
                                ? "border-black bg-white text-black"
                                : "border-red-800 bg-red-50 text-red-900",
                            ].join(" ")}
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_order_number" });
                              setMetroDraft(r.metro_order_number ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            {r.metro_order_number?.trim() ? r.metro_order_number : "-"}
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        {editMetroUnit ? (
                          <input
                            className="h-10 w-24 rounded-xl border-2 border-black px-2 text-sm font-black text-black"
                            value={metroDraft}
                            autoFocus
                            onChange={(e) => setMetroDraft(e.target.value)}
                            onBlur={() => void saveMetroEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveMetroEdit();
                              if (e.key === "Escape") setMetroEditing(null);
                            }}
                            disabled={metroSaveBusy}
                            aria-label="Metro Einheit"
                          />
                        ) : (
                          <button
                            type="button"
                            className="h-10 min-w-[5.5rem] rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-left text-black"
                            onClick={() => {
                              setMetroEditing({ productId: r.productId, field: "metro_unit" });
                              setMetroDraft(r.metro_unit ?? "");
                            }}
                            title="Klicken zum Bearbeiten"
                          >
                            {r.metro_unit?.trim() ? r.metro_unit : "-"}
                          </button>
                        )}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">
                        {r.sum}
                      </td>
                    </tr>
                  );
                })}
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
