"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { listLocations } from "@/lib/db";
import type { Location } from "@/lib/types";
import { errorMessage } from "@/lib/error";
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

type Status = "open" | "confirmed" | "forwarded" | "cancelled";

type Item = {
  id: string;
  product: string;
  quantity: number;
  name: string;
  phone: string;
  pickup_time: string;
  location_id: string;
  location_name: string;
  status: Status;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABEL: Record<Status, string> = {
  open: "Offen",
  confirmed: "Bestätigt",
  forwarded: "Weitergeleitet",
  cancelled: "Storniert",
};

function badgeForStatus(s: Status): string {
  if (s === "open") return adminBadgeWarnClass;
  if (s === "confirmed" || s === "forwarded") return adminBadgeSuccessClass;
  return adminBadgeNeutralClass;
}

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

export default function AdminCustomerOrdersPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("open");
  const [locFilter, setLocFilter] = useState<string>("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  useEffect(() => {
    void (async () => {
      try {
        const all = await listLocations();
        setLocations(all);
      } catch {
        setLocations([]);
      }
    })();
  }, []);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const code = window.prompt("Admin-Code für Kundenbestellungen", "") ?? "";
      if (!code.trim()) {
        setBusy(false);
        return;
      }
      sessionStorage.setItem("customer-orders-admin-code", code);
      const params = new URLSearchParams({ adminCode: code, status: statusFilter });
      if (locFilter) params.set("locationId", locFilter);
      const res = await fetch(`/api/admin/customer-orders/list?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok: boolean; items?: Item[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Fehler beim Laden.");
      setItems(data.items ?? []);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Kundenbestellungen nicht laden."));
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, [statusFilter, locFilter]);

  const reloadSilent = useCallback(async () => {
    setErr(null);
    try {
      const code = sessionStorage.getItem("customer-orders-admin-code") ?? "";
      if (!code) return reload();
      const params = new URLSearchParams({ adminCode: code, status: statusFilter });
      if (locFilter) params.set("locationId", locFilter);
      const res = await fetch(`/api/admin/customer-orders/list?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { ok: boolean; items?: Item[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Fehler beim Laden.");
      setItems(data.items ?? []);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Kundenbestellungen nicht laden."));
    }
  }, [statusFilter, locFilter, reload]);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload();
    // initial prompt for code; subsequent silent reloads via reloadSilent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminHydrated, isAdmin]);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reloadSilent();
  }, [statusFilter, locFilter, adminHydrated, isAdmin, reloadSilent]);

  async function setStatus(id: string, next: Status) {
    setUpdatingId(id);
    setErr(null);
    try {
      const code = sessionStorage.getItem("customer-orders-admin-code") ?? "";
      if (!code) {
        setErr("Bitte Seite neu laden und Admin-Code eingeben.");
        return;
      }
      const res = await fetch("/api/admin/customer-orders/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminCode: code, id, status: next }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Update fehlgeschlagen.");
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: next } : it))
      );
    } catch (e: unknown) {
      setErr(errorMessage(e, "Update fehlgeschlagen."));
    } finally {
      setUpdatingId(null);
    }
  }

  const visible = useMemo(() => items, [items]);

  if (!adminHydrated) return null;
  if (!isAdmin) return null;

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        title="Kundenbestellungen"
        description="Bestellungen aus dem öffentlichen Chat (/order)."
      />

      <div className={adminCardClass}>
        <div className={adminSectionTitleClass}>Filter</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Status
            </span>
            <select
              className={adminSelectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="open">Offen</option>
              <option value="confirmed">Bestätigt</option>
              <option value="forwarded">Weitergeleitet</option>
              <option value="cancelled">Storniert</option>
              <option value="all">Alle</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-black uppercase tracking-wide text-black/55">
              Filiale
            </span>
            <select
              className={adminSelectClass}
              value={locFilter}
              onChange={(e) => setLocFilter(e.target.value)}
            >
              <option value="">Alle Filialen</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className={adminSecondaryButtonClass}
              onClick={() => void reloadSilent()}
              disabled={busy}
            >
              Aktualisieren
            </button>
          </div>
        </div>
      </div>

      {err ? <div className={adminBannerErrorClass}>{err}</div> : null}

      {busy ? (
        <div className={adminBannerInfoClass}>Lade…</div>
      ) : visible.length === 0 ? (
        <div className={adminBannerInfoClass}>
          Keine Bestellungen gefunden.{" "}
          <span className={adminMutedTextClass}>(Filter prüfen)</span>
        </div>
      ) : (
        <div className={adminTableShellClass}>
          <table className={adminTableClass}>
            <thead>
              <tr>
                <th className={adminTableStickyHeadCellClass}>Eingang</th>
                <th className={adminTableStickyHeadCellClass}>Produkt</th>
                <th className={adminTableStickyHeadCellClass}>Stück</th>
                <th className={adminTableStickyHeadCellClass}>Kunde</th>
                <th className={adminTableStickyHeadCellClass}>Telefon</th>
                <th className={adminTableStickyHeadCellClass}>Abholzeit</th>
                <th className={adminTableStickyHeadCellClass}>Filiale</th>
                <th className={adminTableStickyHeadCellClass}>Status</th>
                <th className={adminTableStickyHeadCellClass}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it) => (
                <tr key={it.id} className={adminTableRowClass}>
                  <td className="px-3 py-2 align-top text-[13px] font-bold text-black/70 whitespace-nowrap">
                    {fmtTs(it.created_at)}
                  </td>
                  <td className="px-3 py-2 align-top text-[14px] font-extrabold text-black">
                    {it.product}
                  </td>
                  <td className="px-3 py-2 align-top text-right text-[14px] font-extrabold tabular-nums">
                    {it.quantity}
                  </td>
                  <td className="px-3 py-2 align-top text-[14px] font-bold">{it.name}</td>
                  <td className="px-3 py-2 align-top text-[14px] font-bold whitespace-nowrap">
                    <a
                      href={`tel:${it.phone}`}
                      className="underline decoration-dotted text-black hover:text-black/70"
                    >
                      {it.phone}
                    </a>
                  </td>
                  <td className="px-3 py-2 align-top text-[14px] font-bold">
                    {it.pickup_time}
                  </td>
                  <td className="px-3 py-2 align-top text-[14px] font-bold whitespace-nowrap">
                    {it.location_name}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={badgeForStatus(it.status)}>
                      {STATUS_LABEL[it.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      {it.status !== "confirmed" ? (
                        <button
                          type="button"
                          className={adminPrimaryButtonClass}
                          disabled={updatingId === it.id}
                          onClick={() => void setStatus(it.id, "confirmed")}
                        >
                          Bestätigen
                        </button>
                      ) : null}
                      {it.status !== "forwarded" ? (
                        <button
                          type="button"
                          className={adminSecondaryButtonClass}
                          disabled={updatingId === it.id}
                          onClick={() => void setStatus(it.id, "forwarded")}
                        >
                          Weitergeleitet
                        </button>
                      ) : null}
                      {it.status !== "cancelled" ? (
                        <button
                          type="button"
                          className={adminDangerButtonClass}
                          disabled={updatingId === it.id}
                          onClick={() => void setStatus(it.id, "cancelled")}
                        >
                          Stornieren
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
