"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { useAuth } from "@/app/providers";
import { Button, Input } from "@/app/_components/ui";
import {
  defaultBakeryDeliveryDate,
  getOrCreateBakeryDraftOrder,
  listBakeryOrderItems,
  listBakeryProducts,
  upsertBakeryOrderItems,
} from "@/lib/db";
import type { BakeryOrder, BakeryOrderItem, BakeryProduct } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { isBakeryEnabled } from "@/lib/flags";

export default function BakeryOrderPage() {
  return (
    <RequireAuth>
      <BakeryOrderInner />
    </RequireAuth>
  );
}

function BakeryOrderInner() {
  const { location } = useAuth();
  const locationId = location?.location_id ?? "";

  const [deliveryDate, setDeliveryDate] = useState<string>(defaultBakeryDeliveryDate());
  const [products, setProducts] = useState<BakeryProduct[]>([]);
  const [order, setOrder] = useState<BakeryOrder | null>(null);
  const [items, setItems] = useState<BakeryOrderItem[]>([]);
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.product_id, Math.max(0, Math.floor(Number(it.quantity) || 0)));
    return m;
  }, [items]);

  useEffect(() => {
    if (!isBakeryEnabled()) return;
    if (!locationId) return;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const [prods, ord] = await Promise.all([
          listBakeryProducts(),
          getOrCreateBakeryDraftOrder({ locationId, deliveryDate }),
        ]);
        const its = await listBakeryOrderItems(ord.id);

        setProducts(prods);
        setOrder(ord);
        setItems(its);

        const nextDraft: Record<string, string> = {};
        for (const p of prods) {
          const q = qtyByProduct.get(p.id) ?? 0;
          nextDraft[p.id] = String(q);
        }
        // qtyByProduct is from old items; overwrite using `its` to be safe
        const m2 = new Map<string, number>();
        for (const it of its) m2.set(it.product_id, Math.max(0, Math.floor(Number(it.quantity) || 0)));
        for (const p of prods) nextDraft[p.id] = String(m2.get(p.id) ?? 0);
        setDraftQty(nextDraft);
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Bäckerei-Bestellung nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload explicitly on deliveryDate/location change
  }, [deliveryDate, locationId]);

  async function save() {
    if (!order) return;
    setSaving(true);
    setErr(null);
    try {
      const rows = products.map((p) => ({
        productId: p.id,
        quantity: Math.max(0, Math.floor(Number((draftQty[p.id] ?? "").replace(/[^\d]/g, "")) || 0)),
      }));
      await upsertBakeryOrderItems({ orderId: order.id, items: rows });
      const its = await listBakeryOrderItems(order.id);
      setItems(its);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setSaving(false);
    }
  }

  if (!isBakeryEnabled()) {
    return (
      <main className="w-full px-4 py-8 max-w-2xl mx-auto">
        <div className="rounded-3xl border-2 border-black bg-white p-5">
          <h1 className="text-2xl font-black text-black">Bäckerei Bestellung</h1>
          <p className="mt-2 text-sm font-black text-black/70">
            Modul ist deaktiviert. Setze <code>NEXT_PUBLIC_ENABLE_BAKERY=true</code>.
          </p>
          <div className="mt-4">
            <Link
              href="/bakery"
              className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black"
            >
              Zurück
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!locationId) {
    return (
      <main className="w-full px-4 py-8 max-w-2xl mx-auto">
        <div className="rounded-3xl border-2 border-black bg-white p-5">
          <h1 className="text-2xl font-black text-black">Bäckerei Bestellung</h1>
          <p className="mt-2 text-sm font-black text-black/70">
            Du bist nicht als Filiale eingeloggt.
          </p>
          <div className="mt-4">
            <Link
              href="/bakery"
              className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black"
            >
              Zurück
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full px-4 py-4 pb-28 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-black/50">
            <Link href="/bakery" className="underline">
              ← Bäckerei
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Bestellung</h1>
          <p className="mt-1 text-sm font-black text-black/65">
            Lieferdatum auswählen, Mengen eintragen, speichern.
          </p>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      <div className="mt-5 rounded-3xl border-2 border-black bg-white p-4">
        <div className="text-xs font-black text-black/60">Lieferdatum</div>
        <Input
          type="date"
          value={deliveryDate}
          onChange={(e) => setDeliveryDate(e.target.value)}
          className="mt-2 h-12 text-[16px] font-black"
        />
        {order ? (
          <div className="mt-2 text-[11px] font-black text-black/55">
            Draft #{order.id.slice(0, 8)}
          </div>
        ) : null}
      </div>

      {busy ? (
        <div className="mt-6 text-black font-black">Lade…</div>
      ) : products.length === 0 ? (
        <div className="mt-6 rounded-3xl border-2 border-black bg-white p-4 text-sm font-black text-black/70">
          Keine Bäckerei-Produkte vorhanden. Lege zuerst Einträge in{" "}
          <code>bakery_products</code> an.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-3xl border-2 border-black bg-white">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black bg-black/[0.03]">
                <th className="p-3 font-black text-black">Produkt</th>
                <th className="p-3 font-black text-black tabular-nums w-[140px]">Menge</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-black/10 align-middle">
                  <td className="p-3 font-black text-black">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] font-black text-black/55">{p.unit}</div>
                  </td>
                  <td className="p-3">
                    <input
                      inputMode="numeric"
                      type="tel"
                      className="h-11 w-[120px] rounded-xl border-2 border-black text-center text-lg font-black tabular-nums"
                      value={draftQty[p.id] ?? "0"}
                      onChange={(e) =>
                        setDraftQty((m) => ({
                          ...m,
                          [p.id]: e.target.value.replace(/[^\d]/g, ""),
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button className="h-14 text-lg" disabled={saving || busy || !order} onClick={() => void save()}>
          {saving ? "Speichert…" : "Speichern"}
        </Button>
      </div>
    </main>
  );
}

