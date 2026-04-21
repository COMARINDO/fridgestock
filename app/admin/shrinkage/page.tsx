"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import {
  adminBadgeNeutralClass,
  adminBadgeSuccessClass,
  adminBadgeWarnClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminCardClass,
  adminDangerButtonClass,
  adminMutedTextClass,
  adminPrimaryButtonClass,
  adminSecondaryButtonClass,
  adminSectionTitleClass,
  adminSelectClass,
  adminTableClass,
  adminTableRowClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

type Status = "open" | "booked" | "ignored";

type Row = {
  id: string;
  location_id: string;
  product_id: string;
  session_no: number;
  session_started_at: string | null;
  prev_event_at: string | null;
  prev_event_mode: string | null;
  count_at: string;
  expected_quantity: number;
  counted_quantity: number;
  shrink_quantity: number;
  status: Status;
  booked_at: string | null;
  booked_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  brand: string;
  product_name: string;
  zusatz: string;
  short_name: string;
};

type Session = {
  session_no: number;
  started_at: string;
  ended_at: string;
  count_rows: number;
  distinct_products: number;
};

type LocationOption = { id: string; name: string };

type ApiResponse = {
  ok: boolean;
  error?: string;
  locations?: LocationOption[];
  sessions?: Session[];
  activeLocationId?: string;
  activeSessionNo?: number;
  rows?: Row[];
};

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

function statusBadge(s: Status) {
  if (s === "open") return adminBadgeWarnClass;
  if (s === "booked") return adminBadgeSuccessClass;
  return adminBadgeNeutralClass;
}

const STATUS_LABEL: Record<Status, string> = {
  open: "Offen",
  booked: "Verbucht",
  ignored: "Ignoriert",
};

const STORAGE_KEY = "admin-shrinkage-code";

export default function AdminShrinkagePage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>("");
  const [activeSessionNo, setActiveSessionNo] = useState<number | "">("");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const callApi = useCallback(
    async (params: URLSearchParams): Promise<ApiResponse> => {
      const res = await fetch(`/api/admin/shrinkage/list?${params.toString()}`, {
        cache: "no-store",
      });
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
          code = window.prompt("Admin-Code für Schwund", "") ?? "";
          if (!code.trim()) {
            setBusy(false);
            return;
          }
          sessionStorage.setItem(STORAGE_KEY, code);
        }
        const params = new URLSearchParams({ adminCode: code });
        if (activeLocationId) params.set("locationId", activeLocationId);
        if (activeSessionNo !== "") params.set("sessionNo", String(activeSessionNo));
        if (statusFilter !== "all") params.set("status", statusFilter);
        const data = await callApi(params);
        setLocations(data.locations ?? []);
        setSessions(data.sessions ?? []);
        if (data.activeLocationId) setActiveLocationId(data.activeLocationId);
        if (data.activeSessionNo != null) setActiveSessionNo(data.activeSessionNo);
        setRows(data.rows ?? []);
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Schwund nicht laden."));
        setRows([]);
      } finally {
        setBusy(false);
      }
    },
    [activeLocationId, activeSessionNo, statusFilter, callApi]
  );

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload({ prompt: true });
    // Initial: nur einmal ausführen (mit Prompt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminHydrated, isAdmin]);

  // Reload silently when filters change.
  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    const hasCode = Boolean(sessionStorage.getItem(STORAGE_KEY));
    if (!hasCode) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId, activeSessionNo, statusFilter]);

  async function mutateStatus(row: Row, next: "booked" | "ignored") {
    const code = sessionStorage.getItem(STORAGE_KEY) ?? "";
    if (!code) {
      setErr("Bitte Seite neu laden und Admin-Code eingeben.");
      return;
    }
    setUpdatingId(row.id);
    setErr(null);
    try {
      const endpoint =
        next === "booked"
          ? "/api/admin/shrinkage/book"
          : "/api/admin/shrinkage/ignore";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminCode: code, id: row.id }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Aktion fehlgeschlagen.");
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                status: next,
                booked_at:
                  next === "booked" ? new Date().toISOString() : r.booked_at,
              }
            : r
        )
      );
    } catch (e: unknown) {
      setErr(errorMessage(e, "Aktion fehlgeschlagen."));
    } finally {
      setUpdatingId(null);
    }
  }

  const visibleRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const totals = useMemo(() => {
    let open = 0;
    let booked = 0;
    let ignored = 0;
    let shrinkOpen = 0;
    let shrinkBooked = 0;
    rows.forEach((r) => {
      if (r.status === "open") {
        open += 1;
        shrinkOpen += r.shrink_quantity;
      } else if (r.status === "booked") {
        booked += 1;
        shrinkBooked += r.shrink_quantity;
      } else if (r.status === "ignored") {
        ignored += 1;
      }
    });
    return { open, booked, ignored, shrinkOpen, shrinkBooked };
  }, [rows]);

  if (!adminHydrated) return null;
  if (!isAdmin) return null;

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="Monitoring"
        title="Schwund · Lager"
        description="Differenzen zwischen erwartetem und gezähltem Bestand im Lager. Verbuchen ändert den Bestand nicht – es dient nur der Dokumentation."
      />

      <div className={adminCardClass}>
        <div className={adminSectionTitleClass}>Filter</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Lager
            </span>
            <select
              className={adminSelectClass}
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              disabled={locations.length <= 1}
            >
              {locations.length === 0 ? <option value="">—</option> : null}
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Inventur-Session
            </span>
            <select
              className={adminSelectClass}
              value={activeSessionNo === "" ? "" : String(activeSessionNo)}
              onChange={(e) => {
                const v = e.target.value;
                setActiveSessionNo(v === "" ? "" : Number(v));
              }}
              disabled={sessions.length === 0}
            >
              {sessions.length === 0 ? (
                <option value="">Keine Sessions</option>
              ) : null}
              {sessions.map((s) => (
                <option key={s.session_no} value={s.session_no}>
                  #{s.session_no} · {fmtTs(s.started_at)} · {s.distinct_products} Prod.
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Status
            </span>
            <select
              className={adminSelectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">Alle</option>
              <option value="open">Offen</option>
              <option value="booked">Verbucht</option>
              <option value="ignored">Ignoriert</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={() => void reload()}
            disabled={busy}
          >
            {busy ? "Lade…" : "Aktualisieren"}
          </button>
          <span className={adminMutedTextClass}>
            Offen: <strong className="tabular-nums">{totals.open}</strong>
            {" · "}Verbucht: <strong className="tabular-nums">{totals.booked}</strong>
            {" · "}Ignoriert: <strong className="tabular-nums">{totals.ignored}</strong>
            {" · "}Σ Schwund offen: <strong className="tabular-nums">{totals.shrinkOpen}</strong>
            {totals.shrinkBooked > 0 ? (
              <>
                {" · "}Σ verbucht: <strong className="tabular-nums">{totals.shrinkBooked}</strong>
              </>
            ) : null}
          </span>
        </div>
      </div>

      {err ? <div className={adminBannerErrorClass}>{err}</div> : null}

      {busy && rows.length === 0 ? (
        <div className={adminBannerInfoClass}>Lade…</div>
      ) : visibleRows.length === 0 ? (
        <div className={adminBannerInfoClass}>
          Kein Schwund gefunden.{" "}
          <span className={adminMutedTextClass}>
            (Session wechseln oder Filter prüfen.)
          </span>
        </div>
      ) : (
        <div className={adminTableShellClass}>
          <table className={adminTableClass}>
            <thead>
              <tr>
                <th className={adminTableStickyHeadCellClass}>Produkt</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Erwartet</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Gezählt</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`}>Schwund</th>
                <th className={adminTableStickyHeadCellClass}>Gezählt am</th>
                <th className={adminTableStickyHeadCellClass}>Vor-Event</th>
                <th className={adminTableStickyHeadCellClass}>Status</th>
                <th className={adminTableStickyHeadCellClass}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const pseudo = {
                  brand: r.brand ?? "",
                  product_name: r.product_name ?? "",
                  zusatz: r.zusatz ?? "",
                };
                return (
                  <tr key={r.id} className={adminTableRowClass}>
                    <td className="px-3 py-2 align-top text-[14px] font-extrabold text-black">
                      {formatProductName(pseudo)}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums font-bold text-black/80">
                      {r.expected_quantity}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums font-bold text-black/80">
                      {r.counted_quantity}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums font-black text-red-900">
                      −{r.shrink_quantity}
                    </td>
                    <td className="px-3 py-2 align-top text-[12px] font-bold text-black/70 whitespace-nowrap">
                      {fmtTs(r.count_at)}
                    </td>
                    <td className="px-3 py-2 align-top text-[12px] font-bold text-black/60 whitespace-nowrap">
                      {r.prev_event_mode ?? "—"}
                      {r.prev_event_at ? ` · ${fmtTs(r.prev_event_at)}` : ""}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={statusBadge(r.status)}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.status === "booked" && r.booked_at ? (
                        <div className="mt-1 text-[11px] font-bold text-black/55">
                          {fmtTs(r.booked_at)}
                          {r.booked_by ? ` · ${r.booked_by}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {r.status !== "booked" ? (
                          <button
                            type="button"
                            className={adminPrimaryButtonClass}
                            disabled={updatingId === r.id}
                            onClick={() => void mutateStatus(r, "booked")}
                            title="Schwund als verbucht markieren (Bestand bleibt unverändert)."
                          >
                            Verbuchen
                          </button>
                        ) : null}
                        {r.status !== "ignored" ? (
                          <button
                            type="button"
                            className={adminDangerButtonClass}
                            disabled={updatingId === r.id}
                            onClick={() => void mutateStatus(r, "ignored")}
                            title="Differenz als erklärt / irrelevant markieren."
                          >
                            Ignorieren
                          </button>
                        ) : null}
                      </div>
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
