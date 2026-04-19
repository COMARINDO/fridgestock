"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { useAiConsumptionToggle } from "@/lib/useAiConsumptionToggle";
import {
  deleteAllOpenOrderRequests,
  deleteOpenOrderRequest,
  getWeeklyUsageWithCoverageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOpenOrderRequests,
  listOrderOverrides,
  listProducts,
  processOpenOrderRequests,
  updateOpenOrderRequestQuantity,
  updateProductMetroData,
  upsertOrderOverride,
} from "@/lib/db";
import {
  computeLocalOutletOrder,
  computeRabensteinGesamtOrderFromDemandReports,
  piecesPerOrderUnitFromProductFields,
} from "@/lib/orderSuggestions";
import {
  HOFSTETTEN_NAME,
  KIRCHBERG_NAME,
  RABENSTEIN_FILIALE_NAME,
  RABENSTEIN_GESCHAEFT_NAME,
  RABENSTEIN_LAGER_NAME,
  TEICH_NAME,
} from "@/lib/locationConstants";
import type { Location, OrderOverrideRow, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import {
  adminActionSectionClass,
  adminBadgeNeutralClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerSuccessClass,
  adminBannerWarnClass,
  adminDangerButtonLgClass,
  adminPrimaryButtonLgClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

function resolveLocationIdByName(
  locations: Location[],
  name: string
): string | null {
  const n = name.trim().toLowerCase();
  const hit = locations.find((l) => l.name.trim().toLowerCase() === n);
  return hit?.id ?? null;
}

/** Stück-Bedarf in Metro-Einheiten (Aufrunden; 0 Stück → 0 Einheiten). */
function orderPiecesToUnits(pieces: number, pack: number): number {
  const n = Math.max(0, Math.floor(Number(pieces) || 0));
  const pk = Math.max(1, Math.floor(Number(pack) || 0) || 1);
  if (n <= 0) return 0;
  return Math.ceil(n / pk);
}

type TabId = "demand" | "central" | "hofstetten" | "kirchberg";

type DemandBreakdownItem = {
  id: string;
  locationId: string;
  locationName: string;
  quantity: number;
};

type DemandRowModel = {
  productId: string;
  name: string;
  metro_order_number: string | null;
  metro_unit: string | null;
  stockRabenstein: number;
  breakdown: DemandBreakdownItem[];
  totalDemand: number;
  suggestedOrder: number;
};

type CentralRowModel = {
  productId: string;
  name: string;
  metro_order_number: string | null;
  metro_unit: string | null;
  stockRabenstein: number;
  /** Verbrauch 7 Tage (Stück): Teich + Rabenstein-Filiale (Planungsgröße). */
  bedarf7dStück: number;
  /** Meldungen (Stück), Teich */
  demandTeich: number;
  /** Meldungen (Stück), außer Teich & Zentrallager (im UI: Rabenstein Geschäft + ggf. weitere Melder) */
  demandOther: number;
  /** Stück-Delta für Bestelllogik: Meld. Teich + Meld. (ohne Lager) − Bestand Lager Rabenstein */
  deltaStück: number;
  /** Stück pro Metro-Einheit (min_quantity, sonst reine Zahl in metro_unit, sonst 1) */
  piecesPerOrderUnit: number;
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
  /** Verbrauch / Bedarf (Stück), Rollfenster 7 Tage */
  usage7d: number;
  /** Nachbestell-Bedarf in Stück (Vorschlagslogik) */
  calculatedOrder: number;
  displayOrder: number;
  piecesPerOrderUnit: number;
  calculatedUnits: number;
  displayUnits: number;
  overridden: boolean;
};

function AdminOrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, adminHydrated } = useAdmin();

  const [useAi] = useAiConsumptionToggle();
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [openRequests, setOpenRequests] = useState<
    Array<{ id: string; location_id: string; product_id: string; quantity: number }>
  >([]);
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

  const tabParam = searchParams.get("tab");
  const activeTab: TabId =
    tabParam === "central" ||
    tabParam === "hofstetten" ||
    tabParam === "kirchberg" ||
    tabParam === "demand"
      ? tabParam
      : "demand";

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
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [demandEditingId, setDemandEditingId] = useState<string | null>(null);
  const [demandEditDraft, setDemandEditDraft] = useState("");
  const [demandBusyId, setDemandBusyId] = useState<string | null>(null);

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

  const reload = useCallback(async () => {
    setErr(null);
    const [locs, prods, usageMeta, invAll, ovs, reqs] = await Promise.all([
      listLocations(),
      listProducts(),
      getWeeklyUsageWithCoverageByLocationProduct({ days: 7, useAi }),
      listInventoryAll(),
      listOrderOverrides(),
      listOpenOrderRequests(),
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
    setOpenRequests(
      (Array.isArray(reqs) ? reqs : []).map((r) => ({
        id: String(r.id ?? ""),
        location_id: r.location_id,
        product_id: r.product_id,
        quantity: Math.max(
          0,
          Math.floor(Number((r as { quantity?: unknown }).quantity) || 0)
        ),
      }))
    );
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
      const stockRab = inventoryQty[rabensteinId]?.[p.id] ?? 0;

      const usageTeich7 = tId
        ? Math.max(0, Math.round(usageByLoc[tId]?.[p.id] ?? 0))
        : 0;
      const usageFiliale7 = fId
        ? Math.max(0, Math.round(usageByLoc[fId]?.[p.id] ?? 0))
        : 0;
      const bedarf7dStück = usageTeich7 + usageFiliale7;

      let demandTeich = 0;
      let demandOther = 0;
      for (const req of openRequests) {
        if (req.product_id !== p.id) continue;
        const q = Math.max(0, Math.floor(Number(req.quantity) || 0));
        if (q <= 0) continue;
        if (req.location_id === rabensteinId) continue;
        if (tId && req.location_id === tId) demandTeich += q;
        else demandOther += q;
      }

      const piecesPerUnit = piecesPerOrderUnitFromProductFields({
        min_quantity: p.min_quantity,
        metro_unit: p.metro_unit,
      });
      const deltaStück = demandTeich + demandOther - stockRab;
      const calculatedOrder = computeRabensteinGesamtOrderFromDemandReports({
        demandTeich,
        demandFiliale: demandOther,
        stockRabenstein: stockRab,
        piecesPerOrderUnit: piecesPerUnit,
      });

      const ov = overrideByKey.get(`${rabensteinId}:${p.id}`);
      const overridden = ov !== undefined;
      const displayOrder = overridden ? ov!.quantity : calculatedOrder;

      const include =
        demandTeich > 0 ||
        demandOther > 0 ||
        stockRab > 0 ||
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
        bedarf7dStück,
        demandTeich,
        demandOther,
        deltaStück,
        piecesPerOrderUnit: piecesPerUnit,
        calculatedOrder,
        displayOrder,
        overridden,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return list;
  }, [
    products,
    openRequests,
    inventoryQty,
    usageByLoc,
    overrideByKey,
    rabensteinId,
    teichId,
    filialeId,
  ]);

  const demandRows = useMemo(() => {
    if (!rabensteinId) return [] as DemandRowModel[];
    const locNameById = new Map(locations.map((l) => [l.id, l.name]));

    const byProduct = new Map<string, DemandBreakdownItem[]>();
    for (const r of openRequests) {
      const pid = r.product_id;
      const qty = Math.max(0, Math.floor(Number(r.quantity) || 0));
      if (!pid || qty <= 0) continue;
      // Warehouse should not report demand; ignore if it did.
      if (r.location_id === rabensteinId) continue;
      const list = byProduct.get(pid) ?? [];
      list.push({
        id: r.id,
        locationId: r.location_id,
        locationName: locNameById.get(r.location_id) ?? r.location_id,
        quantity: qty,
      });
      byProduct.set(pid, list);
    }

    const out: DemandRowModel[] = [];
    for (const p of products) {
      const breakdown = byProduct.get(p.id) ?? [];
      breakdown.sort((a, b) => a.locationName.localeCompare(b.locationName, "de"));
      const total = breakdown.reduce((s, b) => s + b.quantity, 0);
      const stockRab = inventoryQty[rabensteinId]?.[p.id] ?? 0;
      const suggestedOrder = Math.max(0, total - stockRab);
      const include = total > 0 || stockRab > 0 || suggestedOrder > 0;
      if (!include) continue;
      out.push({
        productId: p.id,
        name: formatProductName(p),
        metro_order_number: p.metro_order_number ?? null,
        metro_unit: p.metro_unit ?? null,
        stockRabenstein: stockRab,
        breakdown,
        totalDemand: total,
        suggestedOrder,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return out;
  }, [openRequests, products, rabensteinId, inventoryQty, locations]);

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
      const pack = piecesPerOrderUnitFromProductFields({
        min_quantity: p.min_quantity,
        metro_unit: p.metro_unit,
      });
      const calculatedUnits = orderPiecesToUnits(calculatedOrder, pack);
      const displayUnits = orderPiecesToUnits(displayOrder, pack);
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
        piecesPerOrderUnit: pack,
        calculatedUnits,
        displayUnits,
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
      const pack = piecesPerOrderUnitFromProductFields({
        min_quantity: p.min_quantity,
        metro_unit: p.metro_unit,
      });
      const calculatedUnits = orderPiecesToUnits(calculatedOrder, pack);
      const displayUnits = orderPiecesToUnits(displayOrder, pack);
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
        piecesPerOrderUnit: pack,
        calculatedUnits,
        displayUnits,
        overridden,
      });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return list;
  }, [products, usageByLoc, daysCoveredByLoc, inventoryQty, overrideByKey, kirchbergId]);

  const sumCentral = useMemo(
    () => centralRows.reduce((s, r) => s + r.displayOrder, 0),
    [centralRows]
  );
  const sumSuggestedDemand = useMemo(
    () => demandRows.reduce((s, r) => s + r.suggestedOrder, 0),
    [demandRows]
  );
  const sumHof = useMemo(
    () => hofstettenRows.reduce((s, r) => s + r.displayUnits, 0),
    [hofstettenRows]
  );
  const sumKir = useMemo(
    () => kirchbergRows.reduce((s, r) => s + r.displayUnits, 0),
    [kirchbergRows]
  );

  async function saveEdit() {
    if (!editing) return;
    const n = Math.max(0, Math.floor(Number(editDraft.replace(/[^\d]/g, "")) || 0));
    const product = products.find((p) => p.id === editing.productId);
    const pack = piecesPerOrderUnitFromProductFields({
      min_quantity: product?.min_quantity,
      metro_unit: product?.metro_unit,
    });
    const isCentral = Boolean(rabensteinId && editing.locationId === rabensteinId);
    const quantity = isCentral ? n : n * pack;
    setSaveBusy(true);
    setErr(null);
    try {
      await upsertOrderOverride({
        locationId: editing.locationId,
        productId: editing.productId,
        quantity,
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

  async function saveDemandEdit(id: string) {
    const n = Math.max(
      0,
      Math.floor(Number(demandEditDraft.replace(/[^\d]/g, "")) || 0)
    );
    setDemandBusyId(id);
    setErr(null);
    try {
      if (n === 0) {
        await deleteOpenOrderRequest(id);
      } else {
        await updateOpenOrderRequestQuantity({ id, quantity: n });
      }
      setDemandEditingId(null);
      setDemandEditDraft("");
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setDemandBusyId(null);
    }
  }

  async function deleteDemandEntry(id: string, label: string) {
    const ok = window.confirm(`Bedarf „${label}" wirklich löschen?`);
    if (!ok) return;
    setDemandBusyId(id);
    setErr(null);
    try {
      await deleteOpenOrderRequest(id);
      if (demandEditingId === id) {
        setDemandEditingId(null);
        setDemandEditDraft("");
      }
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Bedarf konnte nicht gelöscht werden."));
    } finally {
      setDemandBusyId(null);
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

  const tabTitle =
    activeTab === "demand"
      ? "Rabenstein · Bedarf"
      : activeTab === "central"
        ? "Rabenstein · Lager"
        : activeTab === "hofstetten"
          ? `Schritt 2 · ${HOFSTETTEN_NAME}`
          : `Schritt 3 · ${KIRCHBERG_NAME}`;

  const tabDescription =
    activeTab === "demand"
      ? "Offene Bedarfsmeldungen aus den Platzerln. Chips bearbeiten oder löschen — abschließen unten."
      : activeTab === "central"
        ? "Vorschlag fürs Zentrallager. Δ Stück = Meldungen − Bestand, geteilt durch Stück/Einheit."
        : "Eigene Bestellung für dieses Platzerl. Klick auf die Menge: Override (*).";

  return (
    <main className="w-full px-4 py-6 pb-28 max-w-5xl mx-auto">
      <AdminPageHeader
        eyebrow="Aktionen"
        title="Bestellungen"
        description={tabDescription}
        actions={
          <span className={adminBadgeNeutralClass}>{tabTitle}</span>
        }
      />

      {!rabensteinId && !busy && !err ? (
        <div className={`${adminBannerWarnClass} mt-5`}>
          Platzerl „{RABENSTEIN_LAGER_NAME}“ nicht gefunden. Bitte Namen in den Orten prüfen.
        </div>
      ) : null}

      {!teichId && !busy && !err && rabensteinId && activeTab === "central" ? (
        <div className={`${adminBannerWarnClass} mt-4`}>
          Platzerl „{TEICH_NAME}“ nicht gefunden — Teich-Verbrauch wird als 0 gezählt.
        </div>
      ) : null}

      {!hofstettenId && !busy && !err && activeTab === "hofstetten" ? (
        <div className={`${adminBannerWarnClass} mt-4`}>
          Platzerl „{HOFSTETTEN_NAME}“ nicht gefunden.
        </div>
      ) : null}

      {!kirchbergId && !busy && !err && activeTab === "kirchberg" ? (
        <div className={`${adminBannerWarnClass} mt-4`}>
          Platzerl „{KIRCHBERG_NAME}“ nicht gefunden.
        </div>
      ) : null}

      {busy ? (
        <div className={`${adminBannerInfoClass} mt-6`}>Lade…</div>
      ) : err ? (
        <div className={`${adminBannerErrorClass} mt-5`}>{err}</div>
      ) : null}

      {placeMsg && !busy && !err ? (
        <div className={`${adminBannerSuccessClass} mt-5`}>{placeMsg}</div>
      ) : null}

      {!busy && !err && activeTab === "demand" && rabensteinId ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm font-bold text-black/65">
            <span className={adminBadgeNeutralClass}>{openRequests.length} offene Meldung(en)</span>
          </div>

          <section className={`${adminTableShellClass} mt-3`}>
            <table className={`${adminTableClass} min-w-[720px]`}>
              <thead>
                <tr>
                  <th className={`${adminTableStickyHeadCellClass} text-left`}>
                    Produkt / Bedarf je Platzerl
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>Gesamt</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    {RABENSTEIN_LAGER_NAME} · Bestand
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>Vorschlag</th>
                  <th className={`${adminTableStickyHeadCellClass}`}>Metro</th>
                </tr>
              </thead>
              <tbody>
                {demandRows.map((r) => (
                  <tr key={r.productId} className="border-b border-black/10 align-top">
                    <td className="p-3 max-w-[360px]">
                      <div className="font-black text-black">{r.name}</div>
                      {r.breakdown.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.breakdown.map((b) => {
                            const isEd = demandEditingId === b.id;
                            const isBusy = demandBusyId === b.id;
                            const chipLabel = `${b.locationName}: ${b.quantity}`;
                            if (isEd) {
                              return (
                                <span
                                  key={b.id}
                                  className="inline-flex items-center gap-1 rounded-xl border-2 border-black bg-white px-2 py-1 text-xs font-black text-black"
                                >
                                  <span className="text-black/70">{b.locationName}:</span>
                                  <input
                                    inputMode="numeric"
                                    type="tel"
                                    pattern="[0-9]*"
                                    className="h-7 w-14 rounded-md border-2 border-black text-center text-sm font-black tabular-nums"
                                    value={demandEditDraft}
                                    autoFocus
                                    onChange={(e) =>
                                      setDemandEditDraft(
                                        e.target.value.replace(/[^\d]/g, "")
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") void saveDemandEdit(b.id);
                                      if (e.key === "Escape") {
                                        setDemandEditingId(null);
                                        setDemandEditDraft("");
                                      }
                                    }}
                                    disabled={isBusy}
                                    aria-label={`Bedarf ${b.locationName}`}
                                  />
                                  <button
                                    type="button"
                                    className="h-7 px-2 rounded-md bg-black text-white text-xs font-black disabled:opacity-50"
                                    onClick={() => void saveDemandEdit(b.id)}
                                    disabled={isBusy}
                                  >
                                    OK
                                  </button>
                                  <button
                                    type="button"
                                    className="h-7 px-2 rounded-md border-2 border-black bg-white text-xs font-black disabled:opacity-50"
                                    onClick={() => {
                                      setDemandEditingId(null);
                                      setDemandEditDraft("");
                                    }}
                                    disabled={isBusy}
                                    aria-label="Abbrechen"
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            }
                            return (
                              <span
                                key={b.id}
                                className="inline-flex items-center gap-1 rounded-xl border-2 border-black bg-white pl-2 pr-1 py-1 text-xs font-black text-black"
                              >
                                <button
                                  type="button"
                                  className="font-black text-black disabled:opacity-50"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setDemandEditingId(b.id);
                                    setDemandEditDraft(String(b.quantity));
                                  }}
                                  title="Menge bearbeiten"
                                >
                                  {chipLabel}
                                </button>
                                <button
                                  type="button"
                                  className="h-6 w-6 inline-flex shrink-0 items-center justify-center rounded-md border-2 border-red-800 bg-red-50 text-sm font-black text-red-900 active:scale-[0.99] disabled:opacity-50"
                                  disabled={isBusy}
                                  onClick={() => void deleteDemandEntry(b.id, chipLabel)}
                                  aria-label={`Bedarf ${chipLabel} löschen`}
                                  title="Löschen (irreversibel)"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] font-black text-black/40">
                          Keine Meldungen.
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-black text-black tabular-nums">{r.totalDemand}</td>
                    <td
                      className={[
                        "p-3 font-black tabular-nums",
                        r.stockRabenstein < 0 ? "text-red-800" : "text-black",
                      ].join(" ")}
                    >
                      {r.stockRabenstein}
                      {r.stockRabenstein < 0 ? (
                        <span className="ml-1 text-[11px] font-black text-red-800/80">
                          Backorder
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 font-black text-black tabular-nums">{r.suggestedOrder}</td>
                    <td className="p-3 text-xs font-black text-black/70">
                      {r.metro_order_number ? (
                        <>
                          <div className="font-black text-black">{r.metro_order_number}</div>
                          <div className="text-black/60">{r.metro_unit ?? ""}</div>
                        </>
                      ) : (
                        <span className="text-black/40">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {demandRows.length === 0 ? (
                  <tr>
                    <td className="p-4 text-sm font-black text-black/60" colSpan={5}>
                      Keine offenen Bedarfsmeldungen.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <div className="mt-3 flex items-center justify-end gap-2 text-sm font-bold text-black/70">
            Summe Vorschlag:{" "}
            <span className="font-black text-black tabular-nums">{sumSuggestedDemand}</span>
          </div>

          <section className={`${adminActionSectionClass} mt-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className={adminSectionTitleClass}>Aktionen · Meldungen</h3>
                <p className="mt-1 text-sm font-bold text-black/65 max-w-prose">
                  <strong className="font-black text-black">Alle löschen</strong> entfernt
                  offene Zeilen dauerhaft.{" "}
                  <strong className="font-black text-black">Abschließen</strong> markiert
                  sie nur als verarbeitet — kein Versand an Metro.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={resetBusy || placeBusy || openRequests.length === 0}
                className={adminDangerButtonLgClass}
                onClick={async () => {
                  const ok = window.confirm(
                    `Alle ${openRequests.length} offenen Meldungen unwiderruflich löschen?`
                  );
                  if (!ok) return;
                  setResetBusy(true);
                  setPlaceMsg(null);
                  setErr(null);
                  try {
                    const removed = await deleteAllOpenOrderRequests();
                    setPlaceMsg(`Gelöscht: ${removed} Meldung(en).`);
                    await reload();
                  } catch (e: unknown) {
                    setErr(errorMessage(e, "Meldungen konnten nicht gelöscht werden."));
                  } finally {
                    setResetBusy(false);
                  }
                }}
              >
                {resetBusy ? "Lösche…" : "Alle Meldungen löschen"}
              </button>
              <button
                type="button"
                disabled={placeBusy || resetBusy || openRequests.length === 0}
                className={adminPrimaryButtonLgClass}
                onClick={async () => {
                  const code = window.prompt("Admin-Code eingeben") ?? "";
                  if (!code.trim()) return;
                  setPlaceBusy(true);
                  setPlaceMsg(null);
                  try {
                    const res = await processOpenOrderRequests({
                      adminCode: code,
                    });
                    setPlaceMsg(
                      `Abgeschlossen: ${res.processedRows} Meldung(en) als verarbeitet markiert (kein Metro-Versand).`
                    );
                    await reload();
                  } catch (e: unknown) {
                    setErr(errorMessage(e, "Meldungen konnten nicht abgeschlossen werden."));
                  } finally {
                    setPlaceBusy(false);
                  }
                }}
              >
                {placeBusy ? "Schließe ab…" : "Meldungen abschließen"}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {!busy && !err && activeTab === "central" && rabensteinId ? (
        <>
          <section className={`${adminTableShellClass} mt-5`}>
            <table className={`${adminTableClass} min-w-[640px]`}>
              <thead>
                <tr>
                  <th className={`${adminTableStickyHeadCellClass} text-left`}>Produkt</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bedarf 7d · Stück
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    {RABENSTEIN_LAGER_NAME} · Bestand
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bestellen · Einheiten
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} text-right`}>Metro Nr</th>
                  <th className={`${adminTableStickyHeadCellClass} text-right`}>Einheit</th>
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
                      <td className="p-3 font-black text-black max-w-[240px]">
                        <div className="truncate">{r.name}</div>
                        <div
                          className="mt-1.5 text-[10px] font-black leading-snug text-black/60 tabular-nums"
                          title="Exakt diese Werte fließen in computeRabensteinGesamtOrderFromDemandReports ein (lib/orderSuggestions.ts)."
                        >
                          Δ Stück = Meld. {TEICH_NAME} ({r.demandTeich}) + Meld.{" "}
                          {RABENSTEIN_GESCHAEFT_NAME} ({r.demandOther}) − Bestand {RABENSTEIN_LAGER_NAME} (
                          {r.stockRabenstein}) ={" "}
                          <span className="text-black">{r.deltaStück}</span>
                          {" · "}
                          {r.piecesPerOrderUnit} Stück/Einheit
                          {". "}
                          {r.deltaStück <= 0 ? (
                            <>
                              Δ ≤ 0 → <strong className="text-black">0</strong> Einheiten (Meldungen decken
                              Lagerbestand).
                            </>
                          ) : (
                            <>
                              ⌈{r.deltaStück}÷{r.piecesPerOrderUnit}⌉ ={" "}
                              <strong className="text-black">{r.calculatedOrder}</strong> Einheit(en).
                            </>
                          )}
                        </div>
                        {r.overridden ? (
                          <div className="text-[11px] font-black text-amber-800 mt-1">
                            Manuell: {r.displayOrder} E. (Vorschlag: {r.calculatedOrder} E.)
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 font-black tabular-nums text-black">{r.bedarf7dStück}</td>
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
                      <td className="p-3 text-right">
                        {editMetroNr ? (
                          <input
                            className="ml-auto block h-10 w-28 rounded-xl border-2 border-black px-2 text-right text-sm font-black text-black"
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
                              "ml-auto flex h-10 min-w-[7rem] items-center justify-end rounded-xl border-2 px-2 text-sm font-black",
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
                      <td className="p-3 text-right">
                        {editMetroUnit ? (
                          <input
                            className="ml-auto block h-10 w-24 rounded-xl border-2 border-black px-2 text-right text-sm font-black text-black"
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
                            className="ml-auto flex h-10 min-w-[5.5rem] items-center justify-end rounded-xl border-2 border-black bg-white px-2 text-sm font-black text-black"
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {centralRows.length === 0 ? (
              <p className="p-4 text-sm text-black/60 font-black">Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-3 flex items-center justify-end gap-2 text-sm font-bold text-black/70">
            Summe Einheiten ({RABENSTEIN_LAGER_NAME}):{" "}
            <span className="font-black text-black tabular-nums">{sumCentral}</span>
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "hofstetten" && hofstettenId ? (
        <>
          <section className={`${adminTableShellClass} mt-5`}>
            <table className={`${adminTableClass} min-w-[560px]`}>
              <thead>
                <tr>
                  <th className={`${adminTableStickyHeadCellClass} text-left`}>Produkt</th>
                  <th className={adminTableStickyHeadCellClass}>Metro Nr</th>
                  <th className={adminTableStickyHeadCellClass}>Einheit</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>Bestand</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bedarf 7d · Stück
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bestellen · Einheiten
                  </th>
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
                            Manuell (Vorschlag: {r.calculatedUnits} E.)
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
                              setEditDraft(String(r.displayUnits));
                            }}
                          >
                            {r.displayUnits}
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
          <div className="mt-3 flex items-center justify-end gap-2 text-sm font-bold text-black/70">
            Summe Einheiten ({HOFSTETTEN_NAME}):{" "}
            <span className="font-black text-black tabular-nums">{sumHof}</span>
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "kirchberg" && kirchbergId ? (
        <>
          <section className={`${adminTableShellClass} mt-5`}>
            <table className={`${adminTableClass} min-w-[560px]`}>
              <thead>
                <tr>
                  <th className={`${adminTableStickyHeadCellClass} text-left`}>Produkt</th>
                  <th className={adminTableStickyHeadCellClass}>Metro Nr</th>
                  <th className={adminTableStickyHeadCellClass}>Einheit</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>Bestand</th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bedarf 7d · Stück
                  </th>
                  <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                    Bestellen · Einheiten
                  </th>
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
                            Manuell (Vorschlag: {r.calculatedUnits} E.)
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
                              setEditDraft(String(r.displayUnits));
                            }}
                          >
                            {r.displayUnits}
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
          <div className="mt-3 flex items-center justify-end gap-2 text-sm font-bold text-black/70">
            Summe Einheiten ({KIRCHBERG_NAME}):{" "}
            <span className="font-black text-black tabular-nums">{sumKir}</span>
          </div>
        </>
      ) : null}

    </main>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <main className="w-full px-4 py-8 text-center text-black">
          <p className="font-black">Laden…</p>
        </main>
      }
    >
      <AdminOrdersPageContent />
    </Suspense>
  );
}
