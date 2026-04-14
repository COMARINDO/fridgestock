"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { useAdmin } from "@/app/admin-provider";
import { Button, Input } from "@/app/_components/ui";
import {
  defaultBakeryDeliveryDate,
  getOrCreateBakeryDraftOrder,
  listBakeryOrderLocations,
  listBakeryOrdersForDate,
  listBakeryProducts,
  upsertBakeryOrderItems,
} from "@/lib/db";
import {
  HOFSTETTEN_NAME,
  KIRCHBERG_NAME,
  RABENSTEIN_NAME,
  TEICH_NAME,
} from "@/lib/locationConstants";
import type { BakeryProduct, Location } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { isBakeryEnabled } from "@/lib/flags";

type LocationStyle = { header: string; chip: string; input: string };

function styleForLocationName(name: string): LocationStyle {
  const n = name.trim().toLowerCase();
  if (n === HOFSTETTEN_NAME.toLowerCase()) {
    return {
      header: "bg-emerald-50",
      chip: "bg-emerald-600 text-white",
      input: "focus:ring-emerald-500/40",
    };
  }
  if (n === KIRCHBERG_NAME.toLowerCase()) {
    return {
      header: "bg-pink-50",
      chip: "bg-pink-600 text-white",
      input: "focus:ring-pink-500/40",
    };
  }
  if (n === RABENSTEIN_NAME.toLowerCase()) {
    return {
      header: "bg-amber-50",
      chip: "bg-amber-500 text-black",
      input: "focus:ring-amber-500/40",
    };
  }
  if (n === TEICH_NAME.toLowerCase()) {
    return {
      header: "bg-sky-50",
      chip: "bg-sky-600 text-white",
      input: "focus:ring-sky-500/40",
    };
  }
  return {
    header: "bg-black/[0.03]",
    chip: "bg-black text-white",
    input: "focus:ring-black/20",
  };
}

export default function BakeryFormPage() {
  return (
    <RequireAuth>
      <BakeryFormInner />
    </RequireAuth>
  );
}

function BakeryFormInner() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [deliveryDate, setDeliveryDate] = useState<string>(defaultBakeryDeliveryDate());
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<BakeryProduct[]>([]);
  const [draftByLocProd, setDraftByLocProd] = useState<Record<string, Record<string, string>>>(
    {}
  );
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const totalsByProduct = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of products) out[p.id] = 0;
    for (const loc of locations) {
      const byProd = draftByLocProd[loc.id] ?? {};
      for (const p of products) {
        out[p.id] += Math.max(
          0,
          Math.floor(Number((byProd[p.id] ?? "").replace(/[^\d]/g, "")) || 0)
        );
      }
    }
    return out;
  }, [draftByLocProd, locations, products]);

  async function reload() {
    const [locs, prods, orders] = await Promise.all([
      listBakeryOrderLocations(),
      listBakeryProducts(),
      listBakeryOrdersForDate({ deliveryDate }),
    ]);

    const sortedLocs = [...locs].sort((a, b) => a.name.localeCompare(b.name, "de"));
    const sortedProds = [...prods].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "de")
    );

    const next: Record<string, Record<string, string>> = {};
    for (const loc of sortedLocs) {
      next[loc.id] = {};
      for (const p of sortedProds) next[loc.id][p.id] = "0";
    }
    for (const o of orders) {
      if (!next[o.location_id]) next[o.location_id] = {};
      for (const it of o.items) {
        next[o.location_id][it.product_id] = String(
          Math.max(0, Math.floor(Number(it.quantity) || 0))
        );
      }
    }

    setLocations(sortedLocs);
    setProducts(sortedProds);
    setDraftByLocProd(next);
  }

  useEffect(() => {
    if (!isBakeryEnabled()) return;
    if (!adminHydrated || !isAdmin) return;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        await reload();
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Bestellformular nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on date change
  }, [adminHydrated, deliveryDate, isAdmin]);

  async function saveAll() {
    setSaving(true);
    setErr(null);
    try {
      const orders = await Promise.all(
        locations.map((l) =>
          getOrCreateBakeryDraftOrder({ locationId: l.id, deliveryDate })
        )
      );
      const orderIdByLocation = new Map(orders.map((o) => [o.location_id, o.id]));

      await Promise.all(
        locations.map((l) => {
          const orderId = orderIdByLocation.get(l.id);
          if (!orderId) return Promise.resolve();
          const byProd = draftByLocProd[l.id] ?? {};
          return upsertBakeryOrderItems({
            orderId,
            items: products.map((p) => ({
              productId: p.id,
              quantity: Math.max(
                0,
                Math.floor(Number((byProd[p.id] ?? "").replace(/[^\d]/g, "")) || 0)
              ),
            })),
          });
        })
      );

      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setSaving(false);
    }
  }

  if (!isBakeryEnabled()) {
    return (
      <main className="w-full px-4 py-8 max-w-3xl mx-auto">
        <div className="rounded-3xl border-2 border-black bg-white p-5">
          <h1 className="text-2xl font-black text-black">Bestellformular</h1>
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
    <main className="w-full px-4 py-4 pb-28 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-black/50">
            <Link href="/bakery" className="underline">
              ← Bäckerei
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Bestellformular</h1>
          <p className="mt-1 text-sm font-black text-black/65">
            Farben: Hofstetten grün · Kirchberg rosa · Rabenstein gelb · Teich blau.
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
        <div className="flex gap-2">
          <Button
            className="h-12 w-auto px-4 py-0 text-[15px]"
            disabled={busy || saving}
            onClick={() => void saveAll()}
          >
            {saving ? "Speichert…" : "Speichern"}
          </Button>
          <Link
            href="/bakery/backstube"
            className="h-12 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black"
          >
            Zur Backstube →
          </Link>
        </div>
      </div>

      {busy ? (
        <div className="mt-6 text-black font-black">Lade…</div>
      ) : products.length === 0 ? (
        <div className="mt-6 rounded-3xl border-2 border-black bg-white p-4 text-sm font-black text-black/70">
          Keine Bäckerei-Produkte vorhanden.
        </div>
      ) : (
        <section className="mt-5 overflow-x-auto rounded-3xl border-2 border-black bg-white">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="p-3 font-black text-black bg-black/[0.03]">Produkt</th>
                <th className="p-3 font-black text-black tabular-nums bg-black/[0.03]">
                  Summe
                </th>
                {locations.map((l) => {
                  const st = styleForLocationName(l.name);
                  return (
                    <th key={l.id} className={`p-3 font-black text-black ${st.header}`}>
                      <span className={`inline-flex px-2 py-1 rounded-full text-[12px] font-black ${st.chip}`}>
                        {l.name}
                      </span>
                    </th>
                  );
                })}
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
                  {locations.map((l) => {
                    const st = styleForLocationName(l.name);
                    const v = draftByLocProd[l.id]?.[p.id] ?? "0";
                    return (
                      <td key={l.id} className="p-3">
                        <input
                          inputMode="numeric"
                          type="tel"
                          className={[
                            "h-11 w-[92px] rounded-xl border-2 border-black text-center text-lg font-black tabular-nums",
                            "outline-none focus:ring-2",
                            st.input,
                          ].join(" ")}
                          value={v}
                          onChange={(e) => {
                            const next = e.target.value.replace(/[^\d]/g, "");
                            setDraftByLocProd((m) => ({
                              ...m,
                              [l.id]: { ...(m[l.id] ?? {}), [p.id]: next },
                            }));
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

