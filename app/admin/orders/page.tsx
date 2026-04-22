"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { useOrderFormulaToggle } from "@/lib/useOrderFormulaToggle";
import { useOrderReserveEnabled } from "@/lib/useOrderReserveEnabled";
import { useOrderReservePct } from "@/lib/useOrderReservePct";
import {
  archiveOrderForLocation,
  confirmSubmittedOrderDelivery,
  deleteAllOpenOrderRequests,
  deleteOpenOrderRequest,
  deleteSubmittedOrder,
  getWeeklyUsageWithCoverageByLocationProduct,
  listInventoryAll,
  listLocations,
  listOpenOrderRequests,
  listOrderOverrides,
  listProducts,
  listSubmittedOrders,
  processOpenOrderRequests,
  updateOpenOrderRequestQuantity,
  updateProductMetroData,
  updateSubmittedOrderItems,
  upsertOrderOverride,
} from "@/lib/db";
import {
  applyOrderReservePct,
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
import type { Location, OrderOverrideRow, Product, SubmittedOrderRow } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { downloadOrderPdf, defaultOrderPdfFileName } from "@/lib/exportOrderPdf";
import { formatProductName } from "@/lib/formatProductName";
import {
  adminActionSectionClass,
  adminBadgeNeutralClass,
  adminBadgeWarnClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerSuccessClass,
  adminBannerWarnClass,
  adminBrutalSecondaryButtonLgClass,
  adminDangerButtonLgClass,
  adminEmptyStateClass,
  adminOrderFormulaClass,
  adminPrimaryButtonLgClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableScrollHintClass,
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

type TabId = "demand" | "central" | "hofstetten" | "kirchberg" | "delivery";

function fmtTs(iso: string): string {
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
  /** Reserve-Baseline in Stück (= max(0, deltaStück)). */
  reserveStueckFrom: number;
  /** Nach Reserve-Aufschlag in Stück (ceil). Gleich reserveStueckFrom wenn Reserve = 0. */
  reserveStueckTo: number;
  /** Vorschlag OHNE Reserve-Aufschlag (Einheiten). */
  calculatedOrderBaseline: number;
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
  /** Einheiten-Vorschlag OHNE Reserve-Aufschlag (für Indikator). */
  calculatedUnitsBaseline: number;
  /** Reserve-Baseline in Stück. */
  reserveStueckFrom: number;
  /** Nach Reserve-Aufschlag in Stück. */
  reserveStueckTo: number;
  displayUnits: number;
  overridden: boolean;
};

function AdminOrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, adminHydrated } = useAdmin();

  const [showFormula] = useOrderFormulaToggle();
  const [reserveEnabled] = useOrderReserveEnabled();
  const [reservePctRaw] = useOrderReservePct();
  // Reserve nur dann effektiv, wenn der Switch in der AdminNav aktiv ist —
  // sonst überall unsichtbar (Banner, Indikatoren, Berechnung als 0).
  const reservePct = reserveEnabled ? reservePctRaw : 0;
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
    tabParam === "demand" ||
    tabParam === "delivery"
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

  const [archiveBusy, setArchiveBusy] = useState<TabId | null>(null);
  const [openDeliveries, setOpenDeliveries] = useState<SubmittedOrderRow[]>([]);
  const [deliveryDrafts, setDeliveryDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [deliveryBusyId, setDeliveryBusyId] = useState<string | null>(null);

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
    const [locs, prods, usageMeta, invAll, ovs, reqs, allDeliveries] = await Promise.all([
      listLocations(),
      listProducts(),
      getWeeklyUsageWithCoverageByLocationProduct({ days: 7 }),
      listInventoryAll(),
      listOrderOverrides(),
      listOpenOrderRequests(),
      listSubmittedOrders({ limit: 200 }),
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
    setOpenDeliveries(
      (Array.isArray(allDeliveries) ? allDeliveries : []).filter(
        (o) => !o.delivered_at
      )
    );
    setDeliveryDrafts({});
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
      const calculatedOrderBaseline = computeRabensteinGesamtOrderFromDemandReports({
        demandTeich,
        demandFiliale: demandOther,
        stockRabenstein: stockRab,
        piecesPerOrderUnit: piecesPerUnit,
      });
      // Reserve greift auf STÜCK-Bedarf (deltaStück), dann auf Einheiten runden.
      const reserveStueckFrom = Math.max(0, deltaStück);
      const reserveStueckTo = applyOrderReservePct(reserveStueckFrom, reservePct);
      const calculatedOrder =
        reserveStueckTo > 0 ? Math.ceil(reserveStueckTo / piecesPerUnit) : 0;

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
        reserveStueckFrom,
        reserveStueckTo,
        calculatedOrderBaseline,
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
    reservePct,
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
      const { orderQuantity: calculatedOrderBaseline } = computeLocalOutletOrder({
        usage7d: usage,
        stock,
        daysCovered: daysCoveredByLoc[hofstettenId]?.[p.id] ?? 0,
      });
      const pack = piecesPerOrderUnitFromProductFields({
        min_quantity: p.min_quantity,
        metro_unit: p.metro_unit,
      });
      // Reserve greift auf STÜCK-Bedarf, dann Einheiten aufrunden.
      const reserveStueckFrom = Math.max(0, calculatedOrderBaseline);
      const reserveStueckTo = applyOrderReservePct(reserveStueckFrom, reservePct);
      const calculatedOrder = reserveStueckTo;
      const calculatedUnitsBaseline = orderPiecesToUnits(reserveStueckFrom, pack);
      const calculatedUnits = orderPiecesToUnits(reserveStueckTo, pack);
      const ov = overrideByKey.get(`${hofstettenId}:${p.id}`);
      const overridden = ov !== undefined;
      const displayOrder = overridden ? ov!.quantity : calculatedOrder;
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
        calculatedUnitsBaseline,
        reserveStueckFrom,
        reserveStueckTo,
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
    reservePct,
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
      const { orderQuantity: calculatedOrderBaseline } = computeLocalOutletOrder({
        usage7d: usage,
        stock,
        daysCovered: daysCoveredByLoc[kirchbergId]?.[p.id] ?? 0,
      });
      const pack = piecesPerOrderUnitFromProductFields({
        min_quantity: p.min_quantity,
        metro_unit: p.metro_unit,
      });
      // Reserve greift auf STÜCK-Bedarf, dann Einheiten aufrunden.
      const reserveStueckFrom = Math.max(0, calculatedOrderBaseline);
      const reserveStueckTo = applyOrderReservePct(reserveStueckFrom, reservePct);
      const calculatedOrder = reserveStueckTo;
      const calculatedUnitsBaseline = orderPiecesToUnits(reserveStueckFrom, pack);
      const calculatedUnits = orderPiecesToUnits(reserveStueckTo, pack);
      const ov = overrideByKey.get(`${kirchbergId}:${p.id}`);
      const overridden = ov !== undefined;
      const displayOrder = overridden ? ov!.quantity : calculatedOrder;
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
        calculatedUnitsBaseline,
        reserveStueckFrom,
        reserveStueckTo,
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
    kirchbergId,
    reservePct,
  ]);

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

  type ArchiveTab = "central" | "hofstetten" | "kirchberg";

  function exportCentralOrderAsPdf() {
    const rows = centralRows
      .filter((r) => r.displayOrder > 0)
      .map((r) => ({
        name: r.name,
        metroNr: r.metro_order_number,
        unit: r.metro_unit,
        units: r.displayOrder,
        piecesPerUnit: r.piecesPerOrderUnit,
      }));
    if (rows.length === 0) {
      setErr("Keine Positionen zum Exportieren.");
      return;
    }
    try {
      setErr(null);
      downloadOrderPdf({
        title: `Bestellung ${RABENSTEIN_LAGER_NAME}`,
        subtitle: "Nur Artikel mit Bestellmenge > 0",
        rows,
        includePieces: true,
        fileName: defaultOrderPdfFileName(`Bestellung-${RABENSTEIN_LAGER_NAME}`),
      });
    } catch (e) {
      setErr(errorMessage(e, "PDF-Export fehlgeschlagen."));
    }
  }

  function exportLocalOutletOrderAsPdf(which: "hofstetten" | "kirchberg") {
    const label = which === "hofstetten" ? HOFSTETTEN_NAME : KIRCHBERG_NAME;
    const source = which === "hofstetten" ? hofstettenRows : kirchbergRows;
    const rows = source
      .filter((r) => r.displayOrder > 0)
      .map((r) => ({
        name: r.name,
        metroNr: r.metro_order_number,
        unit: r.metro_unit,
        units: r.displayOrder,
        piecesPerUnit: r.piecesPerOrderUnit,
      }));
    if (rows.length === 0) {
      setErr("Keine Positionen zum Exportieren.");
      return;
    }
    try {
      setErr(null);
      downloadOrderPdf({
        title: `Bestellung ${label}`,
        subtitle: "Nur Artikel mit Bestellmenge > 0",
        rows,
        includePieces: true,
        fileName: defaultOrderPdfFileName(`Bestellung-${label}`),
      });
    } catch (e) {
      setErr(errorMessage(e, "PDF-Export fehlgeschlagen."));
    }
  }

  async function archiveOrderForTab(tab: ArchiveTab) {
    let locationId: string | null = null;
    let label = "";
    let items: Array<{ product_id: string; quantity: number }> = [];
    let closeOpenRequests = false;

    if (tab === "central") {
      if (!rabensteinId) return;
      locationId = rabensteinId;
      label = RABENSTEIN_LAGER_NAME;
      closeOpenRequests = true;
      items = centralRows
        .filter((r) => r.displayOrder > 0)
        .map((r) => ({
          product_id: r.productId,
          quantity: Math.max(0, r.displayOrder * r.piecesPerOrderUnit),
        }));
    } else if (tab === "hofstetten") {
      if (!hofstettenId) return;
      locationId = hofstettenId;
      label = HOFSTETTEN_NAME;
      items = hofstettenRows
        .filter((r) => r.displayOrder > 0)
        .map((r) => ({
          product_id: r.productId,
          quantity: Math.max(0, r.displayOrder),
        }));
    } else {
      if (!kirchbergId) return;
      locationId = kirchbergId;
      label = KIRCHBERG_NAME;
      items = kirchbergRows
        .filter((r) => r.displayOrder > 0)
        .map((r) => ({
          product_id: r.productId,
          quantity: Math.max(0, r.displayOrder),
        }));
    }

    items = items.filter((it) => it.quantity > 0 && it.product_id);
    if (!locationId || items.length === 0) {
      setErr("Keine Positionen zum Archivieren.");
      return;
    }

    const ok = window.confirm(
      `Bestellung für „${label}" mit ${items.length} Position(en) archivieren?` +
        (closeOpenRequests
          ? "\n\nOffene Bedarfsmeldungen werden gleichzeitig als verarbeitet markiert."
          : "")
    );
    if (!ok) return;
    const code = window.prompt("Admin-Code eingeben") ?? "";
    if (!code.trim()) return;

    setArchiveBusy(tab);
    setPlaceMsg(null);
    setErr(null);
    try {
      const res = await archiveOrderForLocation({
        locationId,
        items,
        closeOpenRequests,
        adminCode: code,
      });
      setPlaceMsg(
        `Bestellung archiviert: KW ${res.isoWeek}/${res.isoYear} · ${res.itemCount} Position(en)` +
          (res.closedRequests > 0
            ? ` · ${res.closedRequests} Meldung(en) abgeschlossen`
            : "") +
          ". Sobald die Lieferung kommt, im Tab „Lieferungen“ buchen."
      );
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Bestellung konnte nicht archiviert werden."));
    } finally {
      setArchiveBusy(null);
    }
  }

  function getDeliveryDraft(orderId: string, productId: string, fallback: number): string {
    const map = deliveryDrafts[orderId];
    if (map && Object.prototype.hasOwnProperty.call(map, productId)) {
      return map[productId] ?? "";
    }
    return String(Math.max(0, Math.floor(fallback)));
  }

  function setDeliveryDraft(orderId: string, productId: string, value: string) {
    setDeliveryDrafts((cur) => ({
      ...cur,
      [orderId]: {
        ...(cur[orderId] ?? {}),
        [productId]: value.replace(/[^\d]/g, ""),
      },
    }));
  }

  function deliveryItemsForOrder(o: SubmittedOrderRow): Array<{
    product_id: string;
    quantity: number;
  }> {
    return (o.items ?? []).map((it) => {
      const raw = getDeliveryDraft(o.id, it.product_id, Number(it.quantity ?? 0));
      const n = Math.max(0, Math.floor(Number(raw) || 0));
      return { product_id: it.product_id, quantity: n };
    });
  }

  async function bookDelivery(o: SubmittedOrderRow) {
    const items = deliveryItemsForOrder(o);
    const totalPositions = items.filter((it) => it.quantity > 0).length;
    const ok = window.confirm(
      `Lieferung für KW ${o.iso_week} (${o.iso_year}) buchen?\n\n` +
        `Bestand wird mit ${totalPositions} Position(en) erhöht. Mengen ohne Wert bleiben aus dem Bestand.`
    );
    if (!ok) return;
    const code = window.prompt("Admin-Code eingeben") ?? "";
    if (!code.trim()) return;

    setDeliveryBusyId(o.id);
    setPlaceMsg(null);
    setErr(null);
    try {
      // 1) Persist potentially edited items so the booking uses the correct quantities.
      await updateSubmittedOrderItems({
        orderId: o.id,
        items,
        adminCode: code,
      });
      // 2) Confirm delivery (applies items as positive deltas to inventory).
      const res = await confirmSubmittedOrderDelivery({ id: o.id, adminCode: code });
      setPlaceMsg(
        `Lieferung gebucht: ${res.appliedItems} Position(en) eingebucht.`
      );
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Lieferung konnte nicht gebucht werden."));
    } finally {
      setDeliveryBusyId(null);
    }
  }

  async function deleteDelivery(o: SubmittedOrderRow) {
    const ok = window.confirm(
      `Bestellung KW ${o.iso_week}/${o.iso_year} unwiderruflich löschen?`
    );
    if (!ok) return;
    setDeliveryBusyId(o.id);
    setPlaceMsg(null);
    setErr(null);
    try {
      await deleteSubmittedOrder(o.id);
      setPlaceMsg("Bestellung gelöscht.");
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Bestellung konnte nicht gelöscht werden."));
    } finally {
      setDeliveryBusyId(null);
    }
  }

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );
  const locNameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations]
  );

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
          : activeTab === "kirchberg"
            ? `Schritt 3 · ${KIRCHBERG_NAME}`
            : `Schritt 4 · Lieferungen`;

  const tabDescription =
    activeTab === "demand"
      ? "Offene Bedarfsmeldungen aus den Platzerln. Chips bearbeiten oder löschen — abschließen unten."
      : activeTab === "central"
        ? "Vorschlag fürs Zentrallager. Bei „Bestellung archivieren“ entsteht eine offene Lieferung im Tab 4."
        : activeTab === "hofstetten" || activeTab === "kirchberg"
          ? "Eigene Bestellung für dieses Platzerl. „Bestellung archivieren“ legt eine offene Lieferung an."
          : "Offene Lieferungen. Mengen ggf. anpassen (Teil-Lieferung) und buchen — Bestand wird automatisch erhöht.";

  // Einheitlich gerenderter Mengen-Editor für die drei Tabs (Zentrallager,
  // Hofstetten, Kirchberg). Zuvor war dieselbe JSX dreimal dupliziert; jetzt
  // landet jede visuelle Änderung automatisch an allen drei Stellen.
  function renderQuantityCell(
    locationIdForRow: string | null,
    row: { productId: string; units: number; overridden: boolean }
  ) {
    const isEd =
      !!locationIdForRow &&
      editing?.locationId === locationIdForRow &&
      editing?.productId === row.productId;
    if (isEd) {
      return (
        <div className="flex items-center gap-2 shrink-0">
          <input
            inputMode="numeric"
            type="tel"
            className="h-11 w-20 rounded-xl border-2 border-black text-center text-lg font-black"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value.replace(/[^\d]/g, ""))}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveEdit();
              if (e.key === "Escape") setEditing(null);
            }}
            aria-label="Bestellmenge"
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
      );
    }
    return (
      <button
        type="button"
        className="h-11 min-w-[3rem] rounded-xl border-2 border-black bg-white px-3 text-lg font-black tabular-nums text-black active:scale-[0.99]"
        onClick={() => {
          if (!locationIdForRow) return;
          setEditing({ locationId: locationIdForRow, productId: row.productId });
          setEditDraft(String(row.units));
        }}
        aria-label={`Bestellmenge bearbeiten (aktuell ${row.units})`}
      >
        {row.units}
        {row.overridden ? (
          <span className="ml-1 text-amber-700" title="Override">
            *
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <main className="w-full px-4 py-6 pb-28 max-w-5xl mx-auto">
      <AdminPageHeader
        eyebrow="Aktionen"
        title="Bestellungen"
        description={tabDescription}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={adminBadgeNeutralClass}>{tabTitle}</span>
          </div>
        }
      />

      {reservePct > 0 &&
      (activeTab === "central" ||
        activeTab === "hofstetten" ||
        activeTab === "kirchberg") ? (
        <div
          className={`${adminBannerSuccessClass} mt-4 flex flex-wrap items-center gap-2 text-[12px]`}
        >
          <span className="inline-flex h-5 items-center rounded-md bg-emerald-600 px-1.5 text-white">
            +{reservePct} %
          </span>
          <span>
            Reserve aktiv · auf den Stück-Bedarf aufgeschlagen (aufgerundet), dann werden
            Einheiten neu gerechnet. Overrides bleiben unberührt.
          </span>
        </div>
      ) : null}

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
                    <td className={adminEmptyStateClass} colSpan={5}>
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
                {placeBusy ? "Schließe ab…" : "Meldungen archivieren (ohne Bestellung)"}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {!busy && !err && activeTab === "central" && rabensteinId ? (
        <>
          <section className={`${adminTableShellClass} ${adminTableScrollHintClass} mt-5`}>
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
                  const reserveActive =
                    reservePct > 0 && r.reserveStueckTo > r.reserveStueckFrom;
                  const reserveUnitsBump = r.calculatedOrder > r.calculatedOrderBaseline;
                  return (
                    <tr key={r.productId} className="border-b border-black/10 align-middle">
                      <td className="p-3 font-black text-black max-w-[240px]">
                        <div className="truncate">{r.name}</div>
                        {!showFormula && reserveActive && !r.overridden ? (
                          <div className="mt-0.5 text-[11px] font-black text-emerald-800">
                            +{reservePct} % Reserve · Stück {r.reserveStueckFrom} → {r.reserveStueckTo}
                            {" · "}
                            {reserveUnitsBump
                              ? `${r.calculatedOrderBaseline} → ${r.calculatedOrder} E.`
                              : `weiterhin ${r.calculatedOrder} E.`}
                          </div>
                        ) : null}
                        {showFormula ? (
                          <div
                            className={adminOrderFormulaClass}
                            title="Exakt diese Werte fließen in computeRabensteinGesamtOrderFromDemandReports ein (lib/orderSuggestions.ts)."
                          >
                            Δ Stück = Meld. {TEICH_NAME} ({r.demandTeich}) + Meld.{" "}
                            {RABENSTEIN_GESCHAEFT_NAME} ({r.demandOther}) − Ordarella{" "}
                            {RABENSTEIN_LAGER_NAME} ({r.stockRabenstein}) ={" "}
                            <span className="text-black">{r.deltaStück}</span>
                            {" · "}
                            {r.piecesPerOrderUnit} Stück/Einheit
                            {". "}
                            {r.deltaStück <= 0 ? (
                              <>
                                Δ ≤ 0 → <strong className="text-black">0</strong> Einheiten (Meldungen decken
                                Lagerordarella).
                              </>
                            ) : reservePct > 0 ? (
                              <>
                                +{reservePct}% auf Δ ⌈{r.reserveStueckFrom}·(1+{reservePct}%)⌉ ={" "}
                                {r.reserveStueckTo} Stück · ⌈{r.reserveStueckTo}÷{r.piecesPerOrderUnit}⌉ ={" "}
                                <strong className="text-black">{r.calculatedOrder}</strong> Einheit(en).
                              </>
                            ) : (
                              <>
                                ⌈{r.deltaStück}÷{r.piecesPerOrderUnit}⌉ ={" "}
                                <strong className="text-black">{r.calculatedOrder}</strong> Einheit(en).
                              </>
                            )}
                          </div>
                        ) : null}
                        {r.overridden ? (
                          <div className="text-[11px] font-black text-amber-800 mt-1">
                            Manuell: {r.displayOrder} E. (Vorschlag: {r.calculatedOrder} E.
                            {reserveActive
                              ? ` · +${reservePct} % Reserve: Stück ${r.reserveStueckFrom} → ${r.reserveStueckTo}`
                              : ""}
                            )
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
                        {renderQuantityCell(rabensteinId, {
                          productId: r.productId,
                          units: r.displayOrder,
                          overridden: r.overridden,
                        })}
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
              <p className={adminEmptyStateClass}>Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm font-bold text-black/70">
            <span>
              Summe Einheiten ({RABENSTEIN_LAGER_NAME}):{" "}
              <span className="font-black text-black tabular-nums">{sumCentral}</span>
            </span>
            <button
              type="button"
              disabled={sumCentral <= 0}
              className={adminBrutalSecondaryButtonLgClass}
              onClick={() => exportCentralOrderAsPdf()}
              title="Nur die Artikel mit Bestellmenge > 0 als PDF exportieren"
            >
              PDF Export
            </button>
            <button
              type="button"
              disabled={archiveBusy !== null || sumCentral <= 0}
              className={adminPrimaryButtonLgClass}
              onClick={() => void archiveOrderForTab("central")}
              title="Bestellung als offene Lieferung archivieren und Bedarfsmeldungen abschließen"
            >
              {archiveBusy === "central"
                ? "Archiviere…"
                : "Bestellung archivieren (→ Lieferungen)"}
            </button>
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "hofstetten" && hofstettenId ? (
        <>
          <section className={`${adminTableShellClass} ${adminTableScrollHintClass} mt-5`}>
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
                  const reserveActive =
                    reservePct > 0 && r.reserveStueckTo > r.reserveStueckFrom;
                  const reserveUnitsBump = r.calculatedUnits > r.calculatedUnitsBaseline;
                  return (
                    <tr key={r.productId} className="border-b border-black/10 align-middle">
                      <td className="p-3 font-black text-black max-w-[200px]">
                        <div className="truncate">{r.name}</div>
                        {reserveActive && !r.overridden ? (
                          <div className="mt-0.5 text-[11px] font-black text-emerald-800">
                            +{reservePct} % Reserve · Stück {r.reserveStueckFrom} → {r.reserveStueckTo}
                            {" · "}
                            {reserveUnitsBump
                              ? `${r.calculatedUnitsBaseline} → ${r.calculatedUnits} E.`
                              : `weiterhin ${r.calculatedUnits} E.`}
                          </div>
                        ) : null}
                        {r.overridden ? (
                          <div className="text-[11px] font-black text-amber-800">
                            Manuell (Vorschlag: {r.calculatedUnits} E.
                            {reserveActive
                              ? ` · +${reservePct} % Reserve: Stück ${r.reserveStueckFrom} → ${r.reserveStueckTo}`
                              : ""}
                            )
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
                        {renderQuantityCell(hofstettenId, {
                          productId: r.productId,
                          units: r.displayUnits,
                          overridden: r.overridden,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hofstettenRows.length === 0 ? (
              <p className={adminEmptyStateClass}>Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm font-bold text-black/70">
            <span>
              Summe Einheiten ({HOFSTETTEN_NAME}):{" "}
              <span className="font-black text-black tabular-nums">{sumHof}</span>
            </span>
            <button
              type="button"
              disabled={sumHof <= 0}
              className={adminBrutalSecondaryButtonLgClass}
              onClick={() => exportLocalOutletOrderAsPdf("hofstetten")}
              title="Nur die Artikel mit Bestellmenge > 0 als PDF exportieren"
            >
              PDF Export
            </button>
            <button
              type="button"
              disabled={archiveBusy !== null || sumHof <= 0}
              className={adminPrimaryButtonLgClass}
              onClick={() => void archiveOrderForTab("hofstetten")}
              title="Bestellung als offene Lieferung archivieren"
            >
              {archiveBusy === "hofstetten"
                ? "Archiviere…"
                : "Bestellung archivieren (→ Lieferungen)"}
            </button>
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "kirchberg" && kirchbergId ? (
        <>
          <section className={`${adminTableShellClass} ${adminTableScrollHintClass} mt-5`}>
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
                  const editMetroNr =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_order_number";
                  const editMetroUnit =
                    metroEditing?.productId === r.productId &&
                    metroEditing?.field === "metro_unit";
                  const reserveActive =
                    reservePct > 0 && r.reserveStueckTo > r.reserveStueckFrom;
                  const reserveUnitsBump = r.calculatedUnits > r.calculatedUnitsBaseline;
                  return (
                    <tr key={r.productId} className="border-b border-black/10 align-middle">
                      <td className="p-3 font-black text-black max-w-[200px]">
                        <div className="truncate">{r.name}</div>
                        {reserveActive && !r.overridden ? (
                          <div className="mt-0.5 text-[11px] font-black text-emerald-800">
                            +{reservePct} % Reserve · Stück {r.reserveStueckFrom} → {r.reserveStueckTo}
                            {" · "}
                            {reserveUnitsBump
                              ? `${r.calculatedUnitsBaseline} → ${r.calculatedUnits} E.`
                              : `weiterhin ${r.calculatedUnits} E.`}
                          </div>
                        ) : null}
                        {r.overridden ? (
                          <div className="text-[11px] font-black text-amber-800">
                            Manuell (Vorschlag: {r.calculatedUnits} E.
                            {reserveActive
                              ? ` · +${reservePct} % Reserve: Stück ${r.reserveStueckFrom} → ${r.reserveStueckTo}`
                              : ""}
                            )
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
                        {renderQuantityCell(kirchbergId, {
                          productId: r.productId,
                          units: r.displayUnits,
                          overridden: r.overridden,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {kirchbergRows.length === 0 ? (
              <p className={adminEmptyStateClass}>Keine Positionen.</p>
            ) : null}
          </section>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm font-bold text-black/70">
            <span>
              Summe Einheiten ({KIRCHBERG_NAME}):{" "}
              <span className="font-black text-black tabular-nums">{sumKir}</span>
            </span>
            <button
              type="button"
              disabled={sumKir <= 0}
              className={adminBrutalSecondaryButtonLgClass}
              onClick={() => exportLocalOutletOrderAsPdf("kirchberg")}
              title="Nur die Artikel mit Bestellmenge > 0 als PDF exportieren"
            >
              PDF Export
            </button>
            <button
              type="button"
              disabled={archiveBusy !== null || sumKir <= 0}
              className={adminPrimaryButtonLgClass}
              onClick={() => void archiveOrderForTab("kirchberg")}
              title="Bestellung als offene Lieferung archivieren"
            >
              {archiveBusy === "kirchberg"
                ? "Archiviere…"
                : "Bestellung archivieren (→ Lieferungen)"}
            </button>
          </div>
        </>
      ) : null}

      {!busy && !err && activeTab === "delivery" ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm font-bold text-black/65">
            <span className={adminBadgeNeutralClass}>
              {openDeliveries.length} offene Lieferung(en)
            </span>
          </div>

          {openDeliveries.length === 0 ? (
            <div className={`${adminBannerInfoClass} mt-4`}>
              Keine offenen Lieferungen. Eine Lieferung entsteht, wenn du in einem
              der Bestelltabs „Bestellung archivieren“ klickst.
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {openDeliveries.map((o) => {
                const locName = locNameById.get(o.location_id) ?? o.location_id;
                const items = o.items ?? [];
                const draftSum = deliveryItemsForOrder(o).reduce(
                  (s, it) => s + it.quantity,
                  0
                );
                const isBusy = deliveryBusyId === o.id;
                return (
                  <section key={o.id} className={adminTableShellClass}>
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 bg-zinc-50 p-4">
                      <div className="min-w-0">
                        <div className={adminBadgeWarnClass}>offen</div>
                        <div className="mt-1 text-base font-black text-black">
                          {locName} · KW {o.iso_week}/{o.iso_year}
                        </div>
                        <div className="mt-0.5 text-xs font-bold text-black/55">
                          archiviert: {fmtTs(o.created_at)} · {items.length} Position(en)
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          className={adminDangerButtonLgClass}
                          onClick={() => void deleteDelivery(o)}
                        >
                          {isBusy ? "…" : "Löschen"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || draftSum <= 0}
                          className={adminPrimaryButtonLgClass}
                          onClick={() => void bookDelivery(o)}
                          title="Mengen anwenden und Bestand erhöhen"
                        >
                          {isBusy ? "Buche…" : "Lieferung buchen"}
                        </button>
                      </div>
                    </header>

                    <table className={`${adminTableClass} min-w-[520px]`}>
                      <thead>
                        <tr>
                          <th className={`${adminTableStickyHeadCellClass} text-left`}>
                            Produkt
                          </th>
                          <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                            Bestellt · Stück
                          </th>
                          <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                            Geliefert · Stück
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => {
                          const p = productById.get(it.product_id) ?? null;
                          const label = p ? formatProductName(p) : it.product_id;
                          const draft = getDeliveryDraft(
                            o.id,
                            it.product_id,
                            Number(it.quantity ?? 0)
                          );
                          return (
                            <tr
                              key={it.product_id}
                              className="border-b border-black/10 align-top"
                            >
                              <td className="p-3 font-black text-black max-w-[320px]">
                                {label}
                              </td>
                              <td className="p-3 text-right font-bold tabular-nums text-black/70">
                                {Math.max(0, Math.floor(Number(it.quantity) || 0))}
                              </td>
                              <td className="p-3 text-right">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={draft}
                                  disabled={isBusy}
                                  onChange={(e) =>
                                    setDeliveryDraft(o.id, it.product_id, e.target.value)
                                  }
                                  aria-label="Gelieferte Menge"
                                  className="h-10 w-20 rounded-xl border-2 border-black bg-white px-2 text-right text-base font-black tabular-nums text-black outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
                                />
                              </td>
                            </tr>
                          );
                        })}
                        {items.length === 0 ? (
                          <tr>
                            <td className={adminEmptyStateClass} colSpan={3}>
                              Keine Positionen.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    <div className="border-t border-black/10 bg-zinc-50 p-3 text-right text-xs font-bold text-black/60">
                      Summe geliefert (Stück):{" "}
                      <span className="font-black text-black tabular-nums">
                        {draftSum}
                      </span>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
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
