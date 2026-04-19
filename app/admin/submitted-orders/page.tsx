"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  confirmSubmittedOrderDelivery,
  deleteSubmittedOrder,
  listLocations,
  listProducts,
  listSubmittedOrders,
} from "@/lib/db";
import type { Location, Product, SubmittedOrderRow } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import { adminDangerButtonLgClass } from "@/app/admin/_components/adminUi";

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

export default function AdminSubmittedOrdersPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [locs, setLocs] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<SubmittedOrderRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<SubmittedOrderRow | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [locs, prods, ords] = await Promise.all([
        listLocations(),
        listProducts(),
        listSubmittedOrders({ limit: 500 }),
      ]);
      setLocs(locs);
      setProducts(prods);
      setOrders(ords);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Bestellungen nicht laden."));
      setLocs([]);
      setProducts([]);
      setOrders([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload();
  }, [adminHydrated, isAdmin, reload]);

  const locNameById = useMemo(() => new Map(locs.map((l) => [l.id, l.name])), [locs]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

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
          <h1 className="text-2xl font-black text-black">Abgeschickte Bestellungen</h1>
          <p className="mt-1 text-sm text-black/65">Historie nach Kalenderwoche (Lesen).</p>
        </div>
        <button
          type="button"
          className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          onClick={() => void reload()}
          disabled={busy}
        >
          Reload
        </button>
      </div>

      {busy ? <div className="mt-8 text-black font-black">Lade…</div> : null}
      {err ? <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div> : null}

      {!busy && !err ? (
        <section className="mt-6 overflow-x-auto rounded-3xl border-2 border-black bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black bg-black/[0.03]">
                <th className="p-3 font-black text-black">Titel</th>
                <th className="p-3 font-black text-black">Platzerl</th>
                <th className="p-3 font-black text-black tabular-nums">Positionen</th>
                <th className="p-3 font-black text-black">Zeitpunkt</th>
                <th className="p-3 font-black text-black" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-black/10 align-middle">
                  <td className="p-3 font-black text-black">
                    Bestellung – KW {o.iso_week}
                    {o.delivered_at ? (
                      <span className="ml-2 text-[11px] font-black text-emerald-800">
                        geliefert
                      </span>
                    ) : (
                      <span className="ml-2 text-[11px] font-black text-amber-800">
                        offen
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-black text-black/70">
                    {locNameById.get(o.location_id) ?? o.location_id}
                  </td>
                  <td className="p-3 font-black tabular-nums">{o.items?.length ?? 0}</td>
                  <td className="p-3 font-black text-black/70">{fmtTs(o.created_at)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="h-10 px-3 rounded-2xl border-2 border-black bg-white text-xs font-black text-black active:scale-[0.99]"
                      onClick={() => setOpen(o)}
                    >
                      Ansehen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 ? (
            <p className="p-4 text-sm text-black/60 font-black">Noch keine Bestellungen.</p>
          ) : null}
        </section>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end">
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Bestellung</div>
                <div className="text-2xl font-black leading-tight truncate text-black">
                  KW {open.iso_week} ({open.iso_year})
                </div>
                <div className="mt-1 text-sm font-black text-black/60">
                  {locNameById.get(open.location_id) ?? open.location_id} · {fmtTs(open.created_at)}
                  {open.delivered_at ? ` · geliefert: ${fmtTs(open.delivered_at)}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99] shrink-0"
                onClick={() => setOpen(null)}
              >
                Schließen
              </button>
            </div>

            {!open.delivered_at ? (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={modalBusy}
                  className="h-12 px-4 rounded-2xl border-2 border-black bg-black text-white text-sm font-black active:scale-[0.99] disabled:opacity-50"
                  onClick={() => {
                    void (async () => {
                      const code = window.prompt("Admin-Code eingeben") ?? "";
                      if (!code.trim()) return;
                      setModalBusy(true);
                      setErr(null);
                      try {
                        await confirmSubmittedOrderDelivery({ id: open.id, adminCode: code });
                        setOpen(null);
                        await reload();
                      } catch (e: unknown) {
                        setErr(errorMessage(e, "Lieferung konnte nicht bestätigt werden."));
                      } finally {
                        setModalBusy(false);
                      }
                    })();
                  }}
                >
                  {modalBusy ? "…" : "Lieferung bestätigen"}
                </button>
                <button
                  type="button"
                  disabled={modalBusy}
                  className={`h-12 px-4 ${adminDangerButtonLgClass} disabled:opacity-50`}
                  onClick={() => {
                    void (async () => {
                      const ok = window.confirm("Bestellung wirklich löschen?");
                      if (!ok) return;
                      setModalBusy(true);
                      setErr(null);
                      try {
                        await deleteSubmittedOrder(open.id);
                        setOpen(null);
                        await reload();
                      } catch (e: unknown) {
                        setErr(errorMessage(e, "Bestellung konnte nicht gelöscht werden."));
                      } finally {
                        setModalBusy(false);
                      }
                    })();
                  }}
                >
                  {modalBusy ? "…" : "Löschen"}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border-2 border-emerald-800/30 bg-emerald-50 px-3 py-3 text-emerald-950 text-sm font-black">
                Lieferung bereits bestätigt.
              </div>
            )}

            <ul className="mt-4 space-y-2">
              {(open.items ?? []).map((it) => {
                const p = productById.get(it.product_id) ?? null;
                const label = p ? formatProductName(p) : it.product_id;
                return (
                  <li
                    key={it.product_id}
                    className="flex items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-black text-black truncate">{label}</div>
                      <div className="text-[11px] font-black text-black/55">Produkt-ID: {it.product_id}</div>
                    </div>
                    <div className="shrink-0 text-lg font-black tabular-nums text-black">
                      {it.quantity}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </main>
  );
}

