"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { Button, Input } from "@/app/_components/ui";
import {
  getGlobalOverviewByProduct,
  getWeeklyUsageByLocationProduct,
  listLocations,
  updateProductPricing,
} from "@/lib/db";
import type { Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import {
  classifyProductPerformance,
  performanceLabel,
} from "@/lib/inventoryInsights";

type Row = Product & { quantity: number };

function formatEur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function parsePriceInput(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function AdminPage() {
  const router = useRouter();
  const { isAdmin, tryEnterWithCode, exitAdmin } = useAdmin();
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <main className="w-full px-4 py-6 pb-10 max-w-lg mx-auto">
        <h1 className="text-2xl font-black text-black">Admin-Zugang</h1>
        <p className="mt-2 text-sm text-black/70">Code eingeben, um den Admin-Bereich zu öffnen.</p>
        <div className="mt-6">
          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/[^\d]/g, ""));
              setCodeErr(null);
            }}
            inputMode="numeric"
            type="tel"
            placeholder="Code"
            className="h-14 text-center text-2xl font-black tracking-widest"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (tryEnterWithCode(code)) setCodeErr(null);
                else setCodeErr("Ungültiger Code.");
              }
            }}
          />
        </div>
        <div className="mt-4">
          <Button
            className="h-14 w-full text-lg"
            onClick={() => {
              if (tryEnterWithCode(code)) setCodeErr(null);
              else setCodeErr("Ungültiger Code.");
            }}
          >
            Entsperren
          </Button>
        </div>
        {codeErr ? (
          <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800 font-black">{codeErr}</div>
        ) : null}
      </main>
    );
  }

  return (
    <AdminDashboard
      onExit={() => {
        exitAdmin();
        router.replace("/");
      }}
    />
  );
}

function AdminDashboard({ onExit }: { onExit: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [usageByLoc, setUsageByLoc] = useState<Record<string, Record<string, number>>>(
    {}
  );
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    Record<string, { supplier: string; purchase: string; selling: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [data, locations, usage] = await Promise.all([
      getGlobalOverviewByProduct(),
      listLocations(),
      getWeeklyUsageByLocationProduct({ days: 7 }),
    ]);
    setRows(data);
    setLocs(locations.filter((l) => !l.parent_id).sort((a, b) => a.name.localeCompare(b.name)));
    setUsageByLoc(usage);
    const nextDraft: Record<string, { supplier: string; purchase: string; selling: string }> = {};
    for (const r of data) {
      nextDraft[r.id] = {
        supplier: r.supplier ?? "",
        purchase:
          r.purchase_price != null && r.purchase_price !== undefined
            ? String(r.purchase_price)
            : "",
        selling:
          r.selling_price != null && r.selling_price !== undefined
            ? String(r.selling_price)
            : "",
      };
    }
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        await reload();
      } catch (e: unknown) {
        setErr(errorMessage(e, "Konnte Admin-Daten nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, [reload]);

  const usageTotalByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      let sum = 0;
      for (const loc of locs) {
        sum += Number(usageByLoc[loc.id]?.[r.id] ?? 0);
      }
      m[r.id] = Math.max(0, sum);
    }
    return m;
  }, [rows, locs, usageByLoc]);

  const stats = useMemo(() => {
    let ek = 0;
    let vk = 0;
    let profit = 0;
    for (const r of rows) {
      const q = r.quantity ?? 0;
      const pe = r.purchase_price != null ? Number(r.purchase_price) : null;
      const se = r.selling_price != null ? Number(r.selling_price) : null;
      if (pe != null && Number.isFinite(pe)) ek += q * pe;
      if (se != null && Number.isFinite(se)) vk += q * se;
      if (
        pe != null &&
        se != null &&
        Number.isFinite(pe) &&
        Number.isFinite(se)
      ) {
        profit += q * (se - pe);
      }
    }
    return { ek, vk, profit };
  }, [rows]);

  async function saveRow(productId: string) {
    const d = draft[productId];
    if (!d) return;
    const purchase = parsePriceInput(d.purchase);
    const selling = parsePriceInput(d.selling);
    setSavingId(productId);
    setErr(null);
    try {
      await updateProductPricing({
        productId,
        supplier: d.supplier.trim() ? d.supplier.trim() : null,
        purchasePrice: purchase,
        sellingPrice: selling,
      });
      await reload();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Speichern fehlgeschlagen."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="w-full px-4 py-4 pb-28 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-black">Admin</h1>
          <p className="mt-1 text-sm text-black/65">
            Lieferant, EK/VK, Deckung, Verbrauch & Performance
          </p>
        </div>
        <button
          type="button"
          className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          onClick={onExit}
        >
          Admin-Modus beenden
        </button>
      </div>

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err ? (
        <>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-3xl border-2 border-black bg-white p-4">
              <div className="text-xs font-black text-black/60">Bestandswert (EK)</div>
              <div className="mt-1 text-xl font-black text-black">{formatEur(stats.ek)}</div>
            </div>
            <div className="rounded-3xl border-2 border-black bg-white p-4">
              <div className="text-xs font-black text-black/60">Bestandswert (VK)</div>
              <div className="mt-1 text-xl font-black text-black">{formatEur(stats.vk)}</div>
            </div>
            <div className="rounded-3xl border-2 border-black bg-white p-4">
              <div className="text-xs font-black text-black/60">Rohertrag (Bestand)</div>
              <div className="mt-1 text-xl font-black text-black">{formatEur(stats.profit)}</div>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black">Lieferant</th>
                  <th className="p-3 font-black text-black">EK</th>
                  <th className="p-3 font-black text-black">VK</th>
                  <th className="p-3 font-black text-black">Stk</th>
                  <th className="p-3 font-black text-black">Gewinn / Stk</th>
                  <th className="p-3 font-black text-black">7d</th>
                  <th className="p-3 font-black text-black">Performance</th>
                  <th className="p-3 font-black text-black" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const u = usageTotalByProduct[r.id] ?? 0;
                  const perf = classifyProductPerformance(u);
                  const pe = r.purchase_price != null ? Number(r.purchase_price) : null;
                  const se = r.selling_price != null ? Number(r.selling_price) : null;
                  const unitProfit =
                    pe != null && se != null && Number.isFinite(pe) && Number.isFinite(se)
                      ? se - pe
                      : null;
                  const dr = draft[r.id] ?? {
                    supplier: "",
                    purchase: "",
                    selling: "",
                  };
                  return (
                    <tr key={r.id} className="border-b border-black/10 align-top">
                      <td className="p-3 font-black text-black max-w-[200px]">
                        {formatProductName(r)}
                      </td>
                      <td className="p-3">
                        <Input
                          value={dr.supplier}
                          onChange={(e) =>
                            setDraft((m) => ({
                              ...m,
                              [r.id]: { ...dr, supplier: e.target.value },
                            }))
                          }
                          className="h-10 text-sm min-w-[120px]"
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          value={dr.purchase}
                          onChange={(e) =>
                            setDraft((m) => ({
                              ...m,
                              [r.id]: { ...dr, purchase: e.target.value },
                            }))
                          }
                          inputMode="decimal"
                          className="h-10 text-sm w-24"
                        />
                      </td>
                      <td className="p-3">
                        <Input
                          value={dr.selling}
                          onChange={(e) =>
                            setDraft((m) => ({
                              ...m,
                              [r.id]: { ...dr, selling: e.target.value },
                            }))
                          }
                          inputMode="decimal"
                          className="h-10 text-sm w-24"
                        />
                      </td>
                      <td className="p-3 font-black tabular-nums">{r.quantity}</td>
                      <td className="p-3 font-black tabular-nums">
                        {unitProfit != null ? formatEur(unitProfit) : "—"}
                      </td>
                      <td className="p-3 font-black tabular-nums">{u}</td>
                      <td className="p-3 text-xs font-black">{performanceLabel(perf)}</td>
                      <td className="p-3">
                        <Button
                          type="button"
                          className="h-10 px-3 text-xs"
                          disabled={savingId === r.id}
                          onClick={() => void saveRow(r.id)}
                        >
                          {savingId === r.id ? "…" : "OK"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
