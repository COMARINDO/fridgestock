"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { useAdmin } from "@/app/admin-provider";
import { Button, Input } from "@/app/_components/ui";
import {
  defaultBakeryDeliveryDate,
  listBakeryOrdersForDate,
  listBakeryOrderLocations,
  listBakeryProducts,
} from "@/lib/db";
import type { BakeryProduct, Location } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { isBakeryEnabled } from "@/lib/flags";

export default function BakeryBackstubePage() {
  return (
    <RequireAuth>
      <BackstubeInner />
    </RequireAuth>
  );
}

function BackstubeInner() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [deliveryDate, setDeliveryDate] = useState<string>(defaultBakeryDeliveryDate());
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<BakeryProduct[]>([]);
  const [qtyByLocProd, setQtyByLocProd] = useState<Record<string, Record<string, number>>>(
    {}
  );
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const totalsByProduct = useMemo(() => {
    const out: Record<string, number> = {};
    for (const loc of locations) {
      const byProd = qtyByLocProd[loc.id] ?? {};
      for (const p of products) out[p.id] = (out[p.id] ?? 0) + (byProd[p.id] ?? 0);
    }
    return out;
  }, [locations, products, qtyByLocProd]);

  useEffect(() => {
    if (!isBakeryEnabled()) return;
    if (!adminHydrated || !isAdmin) return;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const [locs, prods, orders] = await Promise.all([
          listBakeryOrderLocations(),
          listBakeryProducts(),
          listBakeryOrdersForDate({ deliveryDate }),
        ]);

        const m: Record<string, Record<string, number>> = {};
        for (const loc of locs) m[loc.id] = {};

        for (const o of orders) {
          if (!m[o.location_id]) m[o.location_id] = {};
          for (const it of o.items) {
            m[o.location_id][it.product_id] = Math.max(
              0,
              Math.floor(Number(it.quantity) || 0)
            );
          }
        }

        setLocations([...locs].sort((a, b) => a.name.localeCompare(b.name, "de")));
        setProducts([...prods].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, "de")));
        setQtyByLocProd(m);
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Backstuben-Übersicht nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, [adminHydrated, deliveryDate, isAdmin]);

  if (!isBakeryEnabled()) {
    return (
      <main className="w-full px-4 py-8 max-w-3xl mx-auto">
        <div className="rounded-3xl border-2 border-black bg-white p-5">
          <h1 className="text-2xl font-black text-black">Backstube</h1>
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
            <Link href="/bakery" className="underline">
              ← Bäckerei
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Backstube Übersicht</h1>
          <p className="mt-1 text-sm font-black text-black/65">
            Summen pro Produkt (lesbar) + Aufteilung je Filiale.
          </p>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      <div className="mt-5 rounded-3xl border-2 border-black bg-white p-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px]">
          <div className="text-xs font-black text-black/60">Lieferdatum</div>
          <Input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
            className="mt-2 h-12 text-[16px] font-black"
          />
        </div>
        <Button
          className="h-12"
          disabled={busy}
          onClick={() => {
            // trigger reload by resetting same state (cheap)
            setDeliveryDate((d) => d);
          }}
        >
          {busy ? "Lade…" : "Neu laden"}
        </Button>
      </div>

      {busy ? (
        <div className="mt-6 text-black font-black">Lade…</div>
      ) : products.length === 0 ? (
        <div className="mt-6 rounded-3xl border-2 border-black bg-white p-4 text-sm font-black text-black/70">
          Keine Bäckerei-Produkte vorhanden.
        </div>
      ) : (
        <section className="mt-5 overflow-x-auto rounded-3xl border-2 border-black bg-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black bg-black/[0.03]">
                <th className="p-3 font-black text-black">Produkt</th>
                <th className="p-3 font-black text-black tabular-nums">Summe</th>
                {locations.map((l) => (
                  <th key={l.id} className="p-3 font-black text-black tabular-nums">
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-black/10 align-middle">
                  <td className="p-3 font-black text-black">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] font-black text-black/55">{p.unit}</div>
                  </td>
                  <td className="p-3 font-black tabular-nums text-black">
                    {totalsByProduct[p.id] ?? 0}
                  </td>
                  {locations.map((l) => (
                    <td key={l.id} className="p-3 font-black tabular-nums text-black">
                      {qtyByLocProd[l.id]?.[p.id] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

