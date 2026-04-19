"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { Input } from "@/app/_components/ui";
import {
  listInventoryHistoryAdmin,
  listLocations,
  deleteInventoryHistoryEntry,
  moveInventoryHistoryToLocation,
  previewMoveInventoryHistoryCount,
} from "@/lib/db";
import type { Location } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import {
  adminBadgeNeutralClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerSuccessClass,
  adminCardClass,
  adminDangerButtonClass,
  adminDangerButtonSmClass,
  adminPrimaryButtonClass,
  adminPrimaryButtonLgClass,
  adminSecondaryButtonClass,
  adminSecondaryButtonLgClass,
  adminSelectClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableRowClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

type ModeFilter = "any" | "count" | "add" | "transfer" | "waste" | "loss";

function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function toIsoFromLocalDatetimeInput(v: string): string {
  // v like "2026-04-14T07:30" (local). Convert to ISO (UTC) for supabase filter.
  const t = v.trim();
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error("Ungültige Zeit.");
  return d.toISOString();
}

export default function AdminBookingsPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [locs, setLocs] = useState<Location[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const [fromLocal, setFromLocal] = useState(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return toLocalDatetimeInputValue(d);
  });
  const [toLocal, setToLocal] = useState(() => toLocalDatetimeInputValue(now));
  const [locationId, setLocationId] = useState<string>("");
  const [mode, setMode] = useState<ModeFilter>("any");
  const [limit, setLimit] = useState("300");

  const [rows, setRows] = useState<
    Array<{
      id: string;
      timestamp: string;
      location_id: string;
      product_id: string;
      location_name?: string;
      product_label?: string;
      quantity: number;
      mode?: string | null;
      is_transfer?: boolean;
    }>
  >([]);

  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFromId, setMoveFromId] = useState("");
  const [moveToId, setMoveToId] = useState("");
  const [moveMode, setMoveMode] = useState<ModeFilter>("any");
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [moveOk, setMoveOk] = useState<string | null>(null);
  const [movePreviewBusy, setMovePreviewBusy] = useState(false);
  const [movePreview, setMovePreview] = useState<number | null>(null);

  const summary = useMemo(() => {
    let waste = 0;
    let loss = 0;
    for (const r of rows) {
      if (r.mode === "waste") waste += 1;
      if (r.mode === "loss") loss += 1;
    }
    return { total: rows.length, waste, loss };
  }, [rows]);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const load = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const [locations, history] = await Promise.all([
        listLocations(),
        listInventoryHistoryAdmin({
          fromIso: toIsoFromLocalDatetimeInput(fromLocal),
          toIso: toIsoFromLocalDatetimeInput(toLocal),
          locationId: locationId || undefined,
          mode,
          limit: Number(limit || "300"),
        }),
      ]);
      setLocs([...locations].sort((a, b) => a.name.localeCompare(b.name, "de")));
      setRows(
        history.map((r) => ({
          id: r.id,
          timestamp: r.timestamp,
          location_id: r.location_id,
          product_id: r.product_id,
          location_name: r.location_name,
          product_label: r.product_label,
          quantity: r.quantity,
          mode: r.mode ?? null,
          is_transfer: r.is_transfer ?? false,
        }))
      );
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Buchungen nicht laden."));
    } finally {
      setBusy(false);
    }
  }, [fromLocal, limit, locationId, mode, toLocal]);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void load();
  }, [adminHydrated, isAdmin, load]);

  const locNameById = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);

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
    <main className="w-full px-4 py-6 pb-28 max-w-5xl mx-auto">
      <AdminPageHeader
        eyebrow="Debug · Historie"
        title="Buchungen"
        description={
          <>
            Übersicht aus <code className="font-mono text-[12px]">inventory_history</code>.
            Umbuchen korrigiert nur die History.{" "}
            <span className="font-black text-red-900/90">
              Löschen und Umbuchen sind irreversibel bzw. riskant.
            </span>
          </>
        }
        actions={
          <button
            type="button"
            className={adminDangerButtonClass}
            onClick={() => {
              setMoveOpen(true);
              setMoveErr(null);
              setMoveOk(null);
              setMoveFromId(locationId || "");
              setMoveToId("");
              setMoveMode(mode);
            }}
          >
            Umbuchen…
          </button>
        }
      />

      {err ? <div className={`${adminBannerErrorClass} mt-5`}>{err}</div> : null}

      <section className={`${adminCardClass} mt-5`}>
        <p className={adminSectionTitleClass}>Filter</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Von">
            <Input
              type="datetime-local"
              value={fromLocal}
              onChange={(e) => setFromLocal(e.target.value)}
              className="h-11 rounded-xl border border-black/15 bg-white px-3 text-[15px] font-bold"
            />
          </Field>
          <Field label="Bis">
            <Input
              type="datetime-local"
              value={toLocal}
              onChange={(e) => setToLocal(e.target.value)}
              className="h-11 rounded-xl border border-black/15 bg-white px-3 text-[15px] font-bold"
            />
          </Field>
          <Field label="Ort">
            <select
              className={adminSelectClass}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Alle</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modus">
            <select
              className={adminSelectClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as ModeFilter)}
            >
              <option value="any">Alle</option>
              <option value="count">Inventur</option>
              <option value="add">Buchen</option>
              <option value="transfer">Transfer</option>
              <option value="waste">Verderb</option>
              <option value="loss">Verlust</option>
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Field label="Limit" inline>
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="h-10 w-24 rounded-xl border border-black/15 bg-white text-center font-black"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <span className={adminBadgeNeutralClass}>
              {summary.total} Zeilen
              {summary.waste || summary.loss
                ? ` · Verderb: ${summary.waste} · Verlust: ${summary.loss}`
                : ""}
            </span>
            <button
              type="button"
              className={adminPrimaryButtonClass}
              onClick={() => void load()}
              disabled={busy}
            >
              {busy ? "Lade…" : "Neu laden"}
            </button>
          </div>
        </div>
      </section>

      <section className={`${adminTableShellClass} mt-5`}>
        <table className={`${adminTableClass} min-w-[880px]`}>
          <thead>
            <tr>
              <th className={`${adminTableStickyHeadCellClass} text-left`}>Zeit</th>
              <th className={`${adminTableStickyHeadCellClass} text-left`}>Ort</th>
              <th className={`${adminTableStickyHeadCellClass} text-left`}>Produkt</th>
              <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>Menge</th>
              <th className={`${adminTableStickyHeadCellClass} text-left`}>Modus</th>
              <th className={`${adminTableStickyHeadCellClass} text-right`}>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={adminTableRowClass}>
                <td className="p-3 font-bold text-black tabular-nums whitespace-nowrap">
                  {new Date(r.timestamp).toLocaleString("de-AT")}
                </td>
                <td className="p-3 font-bold text-black">
                  {r.location_name ?? locNameById.get(r.location_id) ?? r.location_id}
                </td>
                <td className="p-3 font-bold text-black max-w-[360px] truncate">
                  {r.product_label ?? r.product_id}
                </td>
                <td className="p-3 font-black tabular-nums text-black">{r.quantity}</td>
                <td className="p-3">
                  <span className={adminBadgeNeutralClass}>
                    {r.mode ?? (r.is_transfer ? "transfer" : "—")}
                  </span>
                </td>
                <td className="p-3 text-right">
                  <button
                    type="button"
                    className={adminDangerButtonSmClass}
                    disabled={deleteBusyId === r.id}
                    onClick={() => {
                      void (async () => {
                        const ok = window.confirm(
                          `Buchung wirklich löschen?\n\n${r.product_label ?? r.product_id}\n${r.location_name ?? locNameById.get(r.location_id) ?? r.location_id}\n${new Date(r.timestamp).toLocaleString("de-AT")}`
                        );
                        if (!ok) return;
                        setDeleteBusyId(r.id);
                        setErr(null);
                        try {
                          await deleteInventoryHistoryEntry({
                            id: r.id,
                            locationId: r.location_id,
                            productId: r.product_id,
                          });
                          await load();
                        } catch (e: unknown) {
                          const msg = errorMessage(e, "");
                          if (msg.toLowerCase().includes("history row not found")) {
                            // Already deleted; just refresh.
                            await load();
                          } else {
                            setErr(errorMessage(e, "Löschen fehlgeschlagen."));
                          }
                        } finally {
                          setDeleteBusyId(null);
                        }
                      })();
                    }}
                    title="History-Zeile löschen"
                  >
                    {deleteBusyId === r.id ? "Löscht…" : "Löschen"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy ? (
              <tr>
                <td className="p-4 text-sm font-bold text-black/55" colSpan={6}>
                  Keine Buchungen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {moveOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="w-full rounded-t-3xl border-t border-black/10 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={adminBadgeNeutralClass}>Umbuchen</div>
                <div className="mt-1 text-2xl font-black leading-tight text-black">
                  History-Zeilen verschieben
                </div>
                <div className="mt-1 text-sm font-bold text-black/60">
                  Betrifft nur <code className="font-mono text-[12px]">inventory_history</code>,
                  nicht <code className="font-mono text-[12px]">inventory</code>.
                </div>
              </div>
              <button
                type="button"
                className={adminSecondaryButtonClass}
                onClick={() => setMoveOpen(false)}
              >
                Schließen
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Von Ort">
                <select
                  className={adminSelectClass}
                  value={moveFromId}
                  onChange={(e) => setMoveFromId(e.target.value)}
                >
                  <option value="">—</option>
                  {locs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nach Ort">
                <select
                  className={adminSelectClass}
                  value={moveToId}
                  onChange={(e) => setMoveToId(e.target.value)}
                >
                  <option value="">—</option>
                  {locs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Modus">
                <select
                  className={adminSelectClass}
                  value={moveMode}
                  onChange={(e) => setMoveMode(e.target.value as ModeFilter)}
                >
                  <option value="any">Alle</option>
                  <option value="count">Inventur</option>
                  <option value="add">Buchen</option>
                  <option value="transfer">Transfer</option>
                  <option value="waste">Verderb</option>
                  <option value="loss">Verlust</option>
                </select>
              </Field>
              <div className="flex items-end">
                <div className="grid w-full grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={adminSecondaryButtonLgClass}
                    disabled={movePreviewBusy || !moveFromId}
                    onClick={() => {
                      void (async () => {
                        setMovePreviewBusy(true);
                        setMoveErr(null);
                        setMoveOk(null);
                        try {
                          const { rows } = await previewMoveInventoryHistoryCount({
                            fromLocationId: moveFromId,
                            fromIso: toIsoFromLocalDatetimeInput(fromLocal),
                            toIso: toIsoFromLocalDatetimeInput(toLocal),
                            mode: moveMode,
                          });
                          setMovePreview(rows);
                        } catch (e: unknown) {
                          setMoveErr(errorMessage(e, "Vorschau fehlgeschlagen."));
                        } finally {
                          setMovePreviewBusy(false);
                        }
                      })();
                    }}
                  >
                    {movePreviewBusy ? "…" : "Vorschau"}
                  </button>
                  <button
                    type="button"
                    className={adminPrimaryButtonLgClass}
                    disabled={moveBusy || !moveFromId || !moveToId}
                    onClick={() => {
                      void (async () => {
                        setMoveBusy(true);
                        setMoveErr(null);
                        setMoveOk(null);
                        try {
                          const { movedRows } = await moveInventoryHistoryToLocation({
                            fromLocationId: moveFromId,
                            toLocationId: moveToId,
                            fromIso: toIsoFromLocalDatetimeInput(fromLocal),
                            toIso: toIsoFromLocalDatetimeInput(toLocal),
                            mode: moveMode,
                          });
                          setMoveOk(`OK: ${movedRows} Zeilen umgebucht.`);
                          setMovePreview(null);
                          await load();
                        } catch (e: unknown) {
                          setMoveErr(errorMessage(e, "Umbuchen fehlgeschlagen."));
                        } finally {
                          setMoveBusy(false);
                        }
                      })();
                    }}
                  >
                    {moveBusy ? "Umbucht…" : "Umbuchen"}
                  </button>
                </div>
              </div>
            </div>

            {movePreview != null ? (
              <div className={`${adminBannerInfoClass} mt-3`}>
                Vorschau: <span className="tabular-nums">{movePreview}</span> Zeilen würden umgebucht.
              </div>
            ) : null}

            {moveErr ? <div className={`${adminBannerErrorClass} mt-3`}>{moveErr}</div> : null}
            {moveOk ? <div className={`${adminBannerSuccessClass} mt-3`}>{moveOk}</div> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Field({
  label,
  inline,
  children,
}: {
  label: string;
  inline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={
        inline
          ? "flex items-center gap-2"
          : "block"
      }
    >
      <span className="text-[11px] font-black uppercase tracking-[0.08em] text-black/55">
        {label}
      </span>
      <div className={inline ? "" : "mt-1.5"}>{children}</div>
    </label>
  );
}

