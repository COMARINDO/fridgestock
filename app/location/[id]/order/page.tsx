"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Button, ButtonSecondary } from "@/app/_components/ui";
import { useAuth } from "@/app/providers";
import {
  getWeeklyUsageWithCoverageByLocationProduct,
  listProductsWithInventoryForLocation,
  submitOrder,
} from "@/lib/db";
import { computeLocalOutletOrder } from "@/lib/orderSuggestions";
import type { SubmittedOrderItem } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";

function getIsoWeekYear(d: Date): { isoYear: number; isoWeek: number } {
  // ISO week date algorithm: move to Thursday of current week.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoYear, isoWeek: weekNo };
}

export default function LocationOrderPage() {
  return (
    <RequireAuth>
      <LocationOrderInner />
    </RequireAuth>
  );
}

function LocationOrderInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const locationId = params?.id ?? "";
  const { location: sessionLocation } = useAuth();

  const canWrite = useMemo(() => {
    const assigned = sessionLocation?.location_id;
    if (!assigned || !locationId) return false;
    return assigned === locationId;
  }, [sessionLocation?.location_id, locationId]);

  const { isoYear, isoWeek } = useMemo(() => getIsoWeekYear(new Date()), []);

  const [products, setProducts] = useState<Array<{ id: string } & Record<string, any>>>([]);
  const [usageByProduct, setUsageByProduct] = useState<Record<string, number>>({});
  const [daysCoveredByProduct, setDaysCoveredByProduct] = useState<Record<string, number>>({});
  const [draftByProduct, setDraftByProduct] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!locationId) return;
    setBusy(true);
    setErr(null);
    setSubmittedId(null);
    try {
      const [rows, usageMeta] = await Promise.all([
        listProductsWithInventoryForLocation(locationId),
        getWeeklyUsageWithCoverageByLocationProduct({ days: 7, useAi: false }),
      ]);

      setProducts(rows as any);

      const usage = usageMeta.usageByLoc[locationId] ?? {};
      const covered = usageMeta.daysCoveredByLoc[locationId] ?? {};
      setUsageByProduct(usage);
      setDaysCoveredByProduct(covered);

      const nextDraft: Record<string, string> = {};
      for (const p of rows as any[]) {
        const u7 = Math.max(0, Math.round(Number(usage[p.id] ?? 0) || 0));
        const stock = Math.floor(Number(p.quantity ?? 0) || 0);
        const daysCovered = Number(covered[p.id] ?? 0) || 0;
        const { orderQuantity } = computeLocalOutletOrder({ usage7d: u7, stock, daysCovered });
        if (orderQuantity > 0) nextDraft[p.id] = String(orderQuantity);
      }
      setDraftByProduct(nextDraft);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Bestellvorschlag nicht laden."));
      setProducts([]);
      setUsageByProduct({});
      setDaysCoveredByProduct({});
      setDraftByProduct({});
    } finally {
      setBusy(false);
    }
  }, [locationId]);

  useEffect(() => {
    if (!locationId) {
      router.replace("/");
      return;
    }
    void reload();
  }, [locationId, reload, router]);

  const rows = useMemo(() => {
    const out: Array<{
      productId: string;
      name: string;
      stock: number;
      usage7d: number;
      suggested: number;
      draft: string;
    }> = [];
    for (const p of products as any[]) {
      const usage7d = Math.max(0, Math.round(Number(usageByProduct[p.id] ?? 0) || 0));
      const stock = Math.floor(Number(p.quantity ?? 0) || 0);
      const daysCovered = Number(daysCoveredByProduct[p.id] ?? 0) || 0;
      const { orderQuantity: suggested } = computeLocalOutletOrder({
        usage7d,
        stock,
        daysCovered,
      });
      const draft = draftByProduct[p.id] ?? (suggested > 0 ? String(suggested) : "");
      const draftN = Math.max(0, Math.floor(Number(draft.replace(/[^\d]/g, "")) || 0));
      const include = suggested > 0 || draftN > 0;
      if (!include) continue;
      out.push({
        productId: p.id,
        name: formatProductName(p),
        stock,
        usage7d,
        suggested,
        draft,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return out;
  }, [products, usageByProduct, daysCoveredByProduct, draftByProduct]);

  const total = useMemo(
    () =>
      rows.reduce((s, r) => {
        const n = Math.max(0, Math.floor(Number(r.draft.replace(/[^\d]/g, "")) || 0));
        return s + n;
      }, 0),
    [rows]
  );

  async function submit() {
    if (!canWrite) {
      setErr("Keine Schreibrechte für dieses Platzerl.");
      return;
    }
    if (!locationId) return;
    const items: SubmittedOrderItem[] = rows
      .map((r) => ({
        product_id: r.productId,
        quantity: Math.max(0, Math.floor(Number(r.draft.replace(/[^\d]/g, "")) || 0)),
      }))
      .filter((it) => it.quantity > 0);
    if (items.length === 0) {
      setErr("Keine Positionen in der Bestellung.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await submitOrder({ locationId, isoYear, isoWeek, items });
      setSubmittedId(res.id);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Bestellung konnte nicht gespeichert werden."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="w-full px-4 py-4 pb-28 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-black/50">
            <Link href={`/location/${encodeURIComponent(locationId)}`} className="underline">
              ← Zurück
            </Link>
          </div>
          <h1 className="text-2xl font-black text-black mt-1">Bestellen</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
            onClick={() => void reload()}
            disabled={busy || submitting}
          >
            Reload
          </button>
        </div>
      </div>

      {err ? <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div> : null}
      {submittedId ? (
        <div className="mt-6 rounded-3xl border-2 border-emerald-800/30 bg-emerald-50 p-4 text-emerald-950 text-sm font-black">
          Bestellung gespeichert. (ID: {submittedId})
        </div>
      ) : null}

      {busy ? <div className="mt-8 text-black font-black">Lade…</div> : null}

      {!busy ? (
        <>
          {rows.length === 0 ? (
            <div className="mt-6 rounded-3xl border-2 border-black bg-white p-4 text-sm font-black text-black/60">
              Keine Positionen zum Bestellen.
            </div>
          ) : (
            <div className="mt-6 grid gap-3">
              {rows.map((r) => {
                const draftN = Math.max(
                  0,
                  Math.floor(Number((r.draft || "").replace(/[^\d]/g, "")) || 0)
                );
                const draftIsZero = draftN === 0;
                return (
                  <div
                    key={r.productId}
                    className="w-full max-w-full rounded-3xl border-2 border-red-800 bg-red-50 p-4 shadow-sm"
                  >
                    <div className="text-center">
                      <div className="text-lg font-black text-black">{r.name}</div>
                    </div>

                    <div className="mt-4 flex items-center justify-center gap-3">
                      <input
                        inputMode="numeric"
                        type="tel"
                        pattern="[0-9]*"
                        enterKeyHint="done"
                        value={r.draft}
                        onChange={(e) =>
                          setDraftByProduct((m) => ({
                            ...m,
                            [r.productId]: e.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                        className={[
                          "h-14 w-full max-w-[180px] rounded-2xl border-2 px-4 text-center text-3xl font-black text-black outline-none focus:ring-2 focus:ring-black/20",
                          draftIsZero
                            ? "border-black bg-white"
                            : "border-red-800 bg-white",
                        ].join(" ")}
                        placeholder="0"
                        aria-label="Bestellen"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm font-black text-black">
            <div>Summe: {total}</div>
            <div className="flex items-center gap-2">
              <ButtonSecondary
                className="h-12 px-4 w-auto text-sm"
                onClick={() => router.replace(`/location/${encodeURIComponent(locationId)}`)}
              >
                Abbrechen
              </ButtonSecondary>
              <Button
                className="h-12 px-4 w-auto text-sm"
                disabled={submitting || rows.length === 0}
                onClick={() => void submit()}
              >
                {submitting ? "Sende…" : "Bestellung abschicken"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

