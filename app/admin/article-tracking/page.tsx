"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import { useArticleTrackingToggle } from "@/lib/useArticleTrackingToggle";
import {
  adminBadgeDangerClass,
  adminBadgeNeutralClass,
  adminBadgeSuccessClass,
  adminBadgeWarnClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminCardClass,
  adminInputClass,
  adminMutedTextClass,
  adminSecondaryButtonClass,
  adminSectionTitleClass,
  adminSelectClass,
  adminTableClass,
  adminTableRowClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

type ProductRow = {
  id: string;
  brand: string | null;
  product_name: string | null;
  zusatz: string | null;
  short_name: string | null;
};

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  parent_id: string | null;
};

type HistoryRow = {
  id: string;
  location_id: string;
  product_id: string;
  quantity: number;
  timestamp: string;
  is_transfer: boolean;
  mode: string | null;
  prev_quantity: number | null;
  delta: number | null;
  location_name: string;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor: string | null;
  location_id: string | null;
  payload: unknown;
  ok: boolean;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  products?: ProductRow[];
  locations?: LocationRow[];
  days?: number;
  rows?: HistoryRow[];
  audit?: AuditRow[];
  activeProductId?: string | null;
  activeLocationId?: string | null;
};

const STORAGE_KEY = "admin-article-tracking-code";
const SELECTION_KEY = "admin-article-tracking-selection.v1";

const DAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: "7 Tage" },
  { value: 14, label: "14 Tage" },
  { value: 30, label: "30 Tage" },
  { value: 60, label: "60 Tage" },
  { value: 90, label: "90 Tage" },
  { value: 180, label: "180 Tage" },
];

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
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

function productLabel(p: ProductRow): string {
  const base = formatProductName({
    brand: p.brand ?? "",
    product_name: p.product_name ?? "",
    zusatz: p.zusatz ?? "",
  });
  const shortSuffix = (p.short_name ?? "").trim();
  if (base && shortSuffix) return `${base} (${shortSuffix})`;
  if (base) return base;
  return shortSuffix || p.id;
}

type ActionKind = "count" | "add" | "transfer-in" | "transfer-out" | "waste" | "loss" | "adjust" | "other";

function classifyAction(row: HistoryRow): {
  kind: ActionKind;
  label: string;
  badgeClass: string;
} {
  if (row.is_transfer) {
    const isIn = row.delta != null && row.delta > 0;
    if (isIn) {
      return {
        kind: "transfer-in",
        label: "Transfer · rein",
        badgeClass: adminBadgeSuccessClass,
      };
    }
    return {
      kind: "transfer-out",
      label: "Transfer · raus",
      badgeClass: adminBadgeWarnClass,
    };
  }
  const mode = (row.mode ?? "").toLowerCase();
  if (mode === "count") {
    return { kind: "count", label: "Inventur", badgeClass: adminBadgeNeutralClass };
  }
  if (mode === "add") {
    return { kind: "add", label: "Zugang", badgeClass: adminBadgeSuccessClass };
  }
  if (mode === "waste") {
    return { kind: "waste", label: "Bruch", badgeClass: adminBadgeDangerClass };
  }
  if (mode === "loss") {
    return { kind: "loss", label: "Verlust", badgeClass: adminBadgeDangerClass };
  }
  if (mode === "adjust") {
    return {
      kind: "adjust",
      label: "Korrektur",
      badgeClass: adminBadgeWarnClass,
    };
  }
  return {
    kind: "other",
    label: mode ? mode : "—",
    badgeClass: adminBadgeNeutralClass,
  };
}

function formatDelta(delta: number | null): string {
  if (delta == null) return "—";
  if (delta === 0) return "±0";
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function deltaClass(delta: number | null): string {
  if (delta == null || delta === 0) return "text-black/60";
  if (delta > 0) return "text-emerald-700";
  return "text-red-700";
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const keep: string[] = [];
  const note = p.note ?? p.reason;
  if (typeof note === "string" && note.trim()) keep.push(note.trim());
  if (typeof p.quantity === "number") keep.push(`qty=${p.quantity}`);
  if (typeof p.delta === "number") keep.push(`Δ=${p.delta}`);
  return keep.join(" · ");
}

export default function AdminArticleTrackingPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();
  const [toggleEnabled] = useArticleTrackingToggle();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [days, setDays] = useState<number>(30);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState<string>("");

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  // Restore last selection from localStorage.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SELECTION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        productId?: string;
        locationId?: string;
        days?: number;
      };
      if (parsed.productId) setProductId(parsed.productId);
      if (parsed.locationId) setLocationId(parsed.locationId);
      if (typeof parsed.days === "number" && parsed.days > 0) setDays(parsed.days);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SELECTION_KEY,
        JSON.stringify({ productId, locationId, days })
      );
    } catch {
      // ignore
    }
  }, [productId, locationId, days]);

  const callApi = useCallback(
    async (params: URLSearchParams): Promise<ApiResponse> => {
      const res = await fetch(
        `/api/admin/article-history?${params.toString()}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "Fehler beim Laden.");
      return data;
    },
    []
  );

  const reload = useCallback(
    async (opts?: { prompt?: boolean }) => {
      setErr(null);
      setBusy(true);
      try {
        let code = sessionStorage.getItem(STORAGE_KEY) ?? "";
        if (!code || opts?.prompt) {
          code = window.prompt("Admin-Code für Artikel-Tracking", "") ?? "";
          if (!code.trim()) {
            setBusy(false);
            return;
          }
          sessionStorage.setItem(STORAGE_KEY, code);
        }
        const params = new URLSearchParams({
          adminCode: code,
          days: String(days),
        });
        if (productId) params.set("productId", productId);
        if (locationId) params.set("locationId", locationId);
        const data = await callApi(params);
        setProducts(data.products ?? []);
        setLocations(data.locations ?? []);
        setRows(data.rows ?? []);
        setAudit(data.audit ?? []);
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Artikel-Historie nicht laden."));
        setRows([]);
        setAudit([]);
      } finally {
        setBusy(false);
      }
    },
    [days, productId, locationId, callApi]
  );

  // Initial load (with prompt for admin code).
  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload({ prompt: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminHydrated, isAdmin]);

  // Silent reload when filters change (if code is stored).
  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    const hasCode = Boolean(sessionStorage.getItem(STORAGE_KEY));
    if (!hasCode) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, locationId, days]);

  const parentLocations = useMemo(
    () => locations.filter((l) => !l.parent_id),
    [locations]
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const label = productLabel(p).toLowerCase();
      const short = (p.short_name ?? "").toLowerCase();
      return label.includes(q) || short.includes(q);
    });
  }, [products, productSearch]);

  const totals = useMemo(() => {
    let zugang = 0;
    let abgang = 0;
    let counts = 0;
    let transfers = 0;
    rows.forEach((r) => {
      const d = r.delta ?? 0;
      if (r.is_transfer) transfers += 1;
      if ((r.mode ?? "").toLowerCase() === "count") counts += 1;
      if (d > 0) zugang += d;
      else if (d < 0) abgang += -d;
    });
    return { zugang, abgang, counts, transfers };
  }, [rows]);

  const activeProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId]
  );

  if (!adminHydrated) return null;
  if (!isAdmin) return null;

  if (!toggleEnabled) {
    return (
      <div className="flex flex-col gap-4">
        <AdminPageHeader
          eyebrow="Monitoring"
          title="Artikel-Tracking"
          description="Ein-/Ausschalter ist deaktiviert."
        />
        <div className={adminBannerInfoClass}>
          Artikel-Tracking ist ausgeschaltet. Aktiviere es im Admin-Menü links unten
          mit dem Schalter „Artikel-Tracking".
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="Monitoring"
        title="Artikel-Tracking"
        description="Zeigt für einen gewählten Artikel alle Lagerbewegungen (Inventuren, Zugänge, Transfers, Bruch/Verlust, Korrekturen) mit Zeitpunkt, Standort und Veränderung (Δ)."
      />

      <div className={adminCardClass}>
        <div className={adminSectionTitleClass}>Filter</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Produkt
            </span>
            <input
              type="search"
              list="article-tracking-products"
              className={adminInputClass}
              placeholder="Name, Marke oder Kurzname suchen…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <datalist id="article-tracking-products">
              {filteredProducts.map((p) => (
                <option key={p.id} value={productLabel(p)} />
              ))}
            </datalist>
            <select
              className={adminSelectClass}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">— Produkt wählen —</option>
              {filteredProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Standort
            </span>
            <select
              className={adminSelectClass}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Alle Standorte</option>
              {parentLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Zeitraum
            </span>
            <select
              className={adminSelectClass}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 30)}
            >
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={() => void reload()}
            disabled={busy}
          >
            {busy ? "Lade…" : "Aktualisieren"}
          </button>
          {activeProduct ? (
            <span className={adminMutedTextClass}>
              Zugang: <strong className="tabular-nums text-emerald-700">
                +{totals.zugang}
              </strong>
              {" · "}Abgang: <strong className="tabular-nums text-red-700">
                −{totals.abgang}
              </strong>
              {" · "}Inventuren: <strong className="tabular-nums">{totals.counts}</strong>
              {" · "}Transfers: <strong className="tabular-nums">{totals.transfers}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {err ? <div className={adminBannerErrorClass}>{err}</div> : null}

      {!productId ? (
        <div className={adminBannerInfoClass}>
          Bitte ein Produkt auswählen, um die Historie anzuzeigen.
        </div>
      ) : busy && rows.length === 0 ? (
        <div className={adminBannerInfoClass}>Lade…</div>
      ) : rows.length === 0 ? (
        <div className={adminBannerInfoClass}>
          Keine Bewegungen für diesen Artikel im gewählten Zeitraum.
        </div>
      ) : (
        <div className={adminTableShellClass}>
          <table className={adminTableClass}>
            <thead>
              <tr>
                <th className={adminTableStickyHeadCellClass}>Zeitpunkt</th>
                <th className={adminTableStickyHeadCellClass}>Standort</th>
                <th className={adminTableStickyHeadCellClass}>Aktion</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Δ</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Vorher</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Nachher</th>
                <th className={adminTableStickyHeadCellClass}>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const action = classifyAction(row);
                const relatedAudit = audit.find((a) => {
                  const t1 = new Date(a.created_at).getTime();
                  const t2 = new Date(row.timestamp).getTime();
                  return Math.abs(t1 - t2) <= 5_000; // 5s window
                });
                const auditNote = relatedAudit
                  ? `${relatedAudit.actor ?? "admin"} · ${relatedAudit.action}${
                      summarizePayload(relatedAudit.payload)
                        ? ` · ${summarizePayload(relatedAudit.payload)}`
                        : ""
                    }`
                  : "";
                return (
                  <tr key={row.id} className={adminTableRowClass}>
                    <td className="p-3 align-middle whitespace-nowrap tabular-nums">
                      {fmtTs(row.timestamp)}
                    </td>
                    <td className="p-3 align-middle">{row.location_name}</td>
                    <td className="p-3 align-middle">
                      <span className={action.badgeClass}>{action.label}</span>
                    </td>
                    <td
                      className={`p-3 align-middle text-right tabular-nums font-black ${deltaClass(row.delta)}`}
                    >
                      {formatDelta(row.delta)}
                    </td>
                    <td className="p-3 align-middle text-right tabular-nums text-black/60">
                      {row.prev_quantity == null ? "—" : row.prev_quantity}
                    </td>
                    <td className="p-3 align-middle text-right tabular-nums">
                      {row.quantity}
                    </td>
                    <td className="p-3 align-middle text-[12px] text-black/65">
                      {auditNote || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
