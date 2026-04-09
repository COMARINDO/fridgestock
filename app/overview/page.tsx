"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Input } from "@/app/_components/ui";
import { getGlobalOverviewByProduct } from "@/lib/db";
import type { Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";

type Row = Product & { quantity: number };

export default function OverviewPage() {
  return (
    <RequireAuth>
      <OverviewInner />
    </RequireAuth>
  );
}

function OverviewInner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const data = await getGlobalOverviewByProduct();
        setRows(data);
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Überblick nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(t));
  }, [rows, q]);

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 border-b border-black/10 bg-[var(--background)]/90 backdrop-blur">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-[#1f1f1f]">Global</div>
              <div className="text-xl font-extrabold leading-tight">Überblick</div>
            </div>
            <Link href="/" className="text-[15px] font-semibold text-[#1a1a1a]">
              Home
            </Link>
          </div>

          <div className="mt-4">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Produkt suchen…"
              autoFocus
            />
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-4 pb-10">
        {error ? (
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        {busy ? (
          <div className="mt-6 text-[#1f1f1f]">Lade…</div>
        ) : visible.length === 0 ? (
          <div className="mt-6 text-[#1f1f1f]">Keine Produkte.</div>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visible.map((r) => (
              <div
                key={r.id}
                className="w-full max-w-full rounded-3xl border border-black/10 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="text-[18px] font-extrabold truncate">{r.name}</div>
                  </div>
                  <div className="h-9 px-4 rounded-full bg-black/5 text-[#2c2c2c] text-[15px] font-extrabold flex items-center">
                    {r.quantity}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

