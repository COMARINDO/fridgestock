"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { Button, Input } from "@/app/_components/ui";
import {
  listInventoryHistoryAdmin,
  listLocations,
  moveInventoryHistoryToLocation,
  previewMoveInventoryHistoryCount,
} from "@/lib/db";
import type { Location } from "@/lib/types";
import { errorMessage } from "@/lib/error";

type ModeFilter = "any" | "count" | "add" | "transfer";

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
  const { isAdmin, exitAdmin, adminHydrated } = useAdmin();

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

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFromId, setMoveFromId] = useState("");
  const [moveToId, setMoveToId] = useState("");
  const [moveMode, setMoveMode] = useState<ModeFilter>("any");
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [moveOk, setMoveOk] = useState<string | null>(null);
  const [movePreviewBusy, setMovePreviewBusy] = useState(false);
  const [movePreview, setMovePreview] = useState<number | null>(null);

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
    <main className="w-full px-4 py-4 pb-28 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-black/50">
            <Link href="/admin" className="underline">
              ← Admin
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Buchungen (History)</h1>
          <p className="mt-1 text-sm text-black/65">
            Übersicht aus <code>inventory_history</code>. Umbuchen korrigiert nur History.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {err ? (
        <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-3xl border-2 border-black bg-white p-4">
          <div className="text-xs font-black text-black/60">Von</div>
          <Input
            type="datetime-local"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
            className="mt-2 h-12 text-[15px] font-black"
          />
        </div>
        <div className="rounded-3xl border-2 border-black bg-white p-4">
          <div className="text-xs font-black text-black/60">Bis</div>
          <Input
            type="datetime-local"
            value={toLocal}
            onChange={(e) => setToLocal(e.target.value)}
            className="mt-2 h-12 text-[15px] font-black"
          />
        </div>
        <div className="rounded-3xl border-2 border-black bg-white p-4">
          <div className="text-xs font-black text-black/60">Ort</div>
          <select
            className="mt-2 h-12 w-full rounded-2xl border-2 border-black bg-white px-3 text-[15px] font-black"
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
        </div>
        <div className="rounded-3xl border-2 border-black bg-white p-4">
          <div className="text-xs font-black text-black/60">Modus</div>
          <select
            className="mt-2 h-12 w-full rounded-2xl border-2 border-black bg-white px-3 text-[15px] font-black"
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeFilter)}
          >
            <option value="any">Alle</option>
            <option value="count">Inventur</option>
            <option value="add">Auffüllen</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-xs font-black text-black/60">Limit</div>
          <Input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="h-11 w-28 text-center font-black"
          />
        </div>
        <div className="flex gap-2">
          <Button className="h-12 w-auto px-4 py-0 text-[15px]" onClick={() => void load()}>
            {busy ? "Lade…" : "Neu laden"}
          </Button>
          <button
            type="button"
            className="h-12 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
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
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-3xl border-2 border-black bg-white">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead>
            <tr className="border-b-2 border-black bg-black/[0.03]">
              <th className="p-3 font-black text-black">Zeit</th>
              <th className="p-3 font-black text-black">Ort</th>
              <th className="p-3 font-black text-black">Produkt</th>
              <th className="p-3 font-black text-black tabular-nums">Menge</th>
              <th className="p-3 font-black text-black">Modus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-black/10 align-middle">
                <td className="p-3 font-black text-black tabular-nums">
                  {new Date(r.timestamp).toLocaleString("de-AT")}
                </td>
                <td className="p-3 font-black text-black">
                  {r.location_name ?? locNameById.get(r.location_id) ?? r.location_id}
                </td>
                <td className="p-3 font-black text-black max-w-[360px] truncate">
                  {r.product_label ?? r.product_id}
                </td>
                <td className="p-3 font-black text-black tabular-nums">{r.quantity}</td>
                <td className="p-3">
                  <span className="inline-flex px-2 py-1 rounded-full border-2 border-black text-[12px] font-black">
                    {r.mode ?? (r.is_transfer ? "transfer" : "—")}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy ? (
              <tr>
                <td className="p-4 text-sm font-black text-black/60" colSpan={5}>
                  Keine Buchungen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {moveOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-black">Umbuchen</div>
                <div className="text-2xl font-black leading-tight text-black">
                  History-Zeilen verschieben
                </div>
                <div className="mt-1 text-sm font-black text-black/60">
                  Betrifft nur <code>inventory_history</code>, nicht <code>inventory</code>.
                </div>
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99]"
                onClick={() => setMoveOpen(false)}
              >
                Schließen
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <div className="text-sm font-black text-black">Von Ort</div>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border-2 border-black bg-white px-3 text-[15px] font-black"
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
              </div>
              <div>
                <div className="text-sm font-black text-black">Nach Ort</div>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border-2 border-black bg-white px-3 text-[15px] font-black"
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
              </div>
              <div>
                <div className="text-sm font-black text-black">Modus</div>
                <select
                  className="mt-2 h-12 w-full rounded-2xl border-2 border-black bg-white px-3 text-[15px] font-black"
                  value={moveMode}
                  onChange={(e) => setMoveMode(e.target.value as ModeFilter)}
                >
                  <option value="any">Alle</option>
                  <option value="count">Inventur</option>
                  <option value="add">Auffüllen</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div className="flex items-end">
                <div className="w-full grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="h-12 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99] disabled:opacity-50"
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
                  <Button
                    className="h-12"
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
                  </Button>
                </div>
              </div>
            </div>

            {movePreview != null ? (
              <div className="mt-3 rounded-3xl border-2 border-black bg-white p-4 text-sm font-black text-black">
                Vorschau: <span className="tabular-nums">{movePreview}</span> Zeilen würden umgebucht.
              </div>
            ) : null}

            {moveErr ? (
              <div className="mt-3 rounded-3xl bg-red-50 p-4 text-red-800">{moveErr}</div>
            ) : null}
            {moveOk ? (
              <div className="mt-3 rounded-3xl bg-emerald-50 p-4 text-emerald-900 font-black">
                {moveOk}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

