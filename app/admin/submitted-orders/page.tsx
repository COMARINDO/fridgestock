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
import {
  adminBadgeNeutralClass,
  adminBadgeSuccessClass,
  adminBadgeWarnClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerSuccessClass,
  adminDangerButtonLgClass,
  adminPrimaryButtonLgClass,
  adminSecondaryButtonClass,
  adminTableClass,
  adminTableRowClass,
  adminTableShellClass,
  adminTableStickyHeadCellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

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
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
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

  return (
    <main className="w-full px-4 py-6 pb-28 max-w-5xl mx-auto">
      <AdminPageHeader
        eyebrow="Debug · Historie"
        title="Abgeschickte Bestellungen"
        description="Bestellungen pro Kalenderwoche. Lieferung bestätigen oder Eintrag löschen."
        actions={
          <button
            type="button"
            className={adminSecondaryButtonClass}
            onClick={() => void reload()}
            disabled={busy}
          >
            Neu laden
          </button>
        }
      />

      {err ? <div className={`${adminBannerErrorClass} mt-5`}>{err}</div> : null}
      {busy ? <div className={`${adminBannerInfoClass} mt-5`}>Lade…</div> : null}

      {!busy && !err ? (
        <section className={`${adminTableShellClass} mt-5`}>
          <table className={`${adminTableClass} min-w-[760px]`}>
            <thead>
              <tr>
                <th className={`${adminTableStickyHeadCellClass} text-left`}>Titel</th>
                <th className={`${adminTableStickyHeadCellClass} text-left`}>Platzerl</th>
                <th className={`${adminTableStickyHeadCellClass} tabular-nums`}>
                  Positionen
                </th>
                <th className={`${adminTableStickyHeadCellClass} text-left`}>Zeitpunkt</th>
                <th className={`${adminTableStickyHeadCellClass} text-right`} />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className={adminTableRowClass}>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-black">
                        Bestellung KW {o.iso_week}
                      </span>
                      {o.delivered_at ? (
                        <span className={adminBadgeSuccessClass}>geliefert</span>
                      ) : (
                        <span className={adminBadgeWarnClass}>offen</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 font-bold text-black/70">
                    {locNameById.get(o.location_id) ?? o.location_id}
                  </td>
                  <td className="p-3 font-black tabular-nums text-black">
                    {o.items?.length ?? 0}
                  </td>
                  <td className="p-3 font-bold text-black/70 tabular-nums">
                    {fmtTs(o.created_at)}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      className={adminSecondaryButtonClass}
                      onClick={() => setOpen(o)}
                    >
                      Ansehen
                    </button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <tr>
                  <td className="p-4 text-sm font-bold text-black/55" colSpan={5}>
                    Noch keine Bestellungen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-black/10 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={adminBadgeNeutralClass}>Bestellung</div>
                <div className="mt-1 text-2xl font-black leading-tight text-black truncate">
                  KW {open.iso_week} ({open.iso_year})
                </div>
                <div className="mt-1 text-sm font-bold text-black/60">
                  {locNameById.get(open.location_id) ?? open.location_id} ·{" "}
                  {fmtTs(open.created_at)}
                  {open.delivered_at ? ` · geliefert: ${fmtTs(open.delivered_at)}` : ""}
                </div>
              </div>
              <button
                type="button"
                className={adminSecondaryButtonClass}
                onClick={() => setOpen(null)}
              >
                Schließen
              </button>
            </div>

            {!open.delivered_at ? (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={modalBusy}
                  className={adminPrimaryButtonLgClass}
                  onClick={() => {
                    void (async () => {
                      const code = window.prompt("Admin-Code eingeben") ?? "";
                      if (!code.trim()) return;
                      setModalBusy(true);
                      setErr(null);
                      try {
                        await confirmSubmittedOrderDelivery({
                          id: open.id,
                          adminCode: code,
                        });
                        setOpen(null);
                        await reload();
                      } catch (e: unknown) {
                        setErr(
                          errorMessage(e, "Lieferung konnte nicht bestätigt werden.")
                        );
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
                  className={adminDangerButtonLgClass}
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
                        setErr(
                          errorMessage(e, "Bestellung konnte nicht gelöscht werden.")
                        );
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
              <div className={`${adminBannerSuccessClass} mt-4`}>
                Lieferung bereits bestätigt.
              </div>
            )}

            <ul className="mt-4 flex flex-col gap-2">
              {(open.items ?? []).map((it) => {
                const p = productById.get(it.product_id) ?? null;
                const label = p ? formatProductName(p) : it.product_id;
                return (
                  <li
                    key={it.product_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-black text-black truncate">{label}</div>
                      <div className="text-[11px] font-bold text-black/55">
                        Produkt-ID: {it.product_id}
                      </div>
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
