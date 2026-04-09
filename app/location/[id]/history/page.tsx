"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Input } from "@/app/_components/ui";
import {
  getInventoryHistoryForLocation,
  getLocation,
  listProducts,
  listUsers,
} from "@/lib/db";
import type { InventoryHistoryRow, Location, Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";

export default function HistoryPage() {
  return (
    <RequireAuth>
      <HistoryInner />
    </RequireAuth>
  );
}

function HistoryInner() {
  const params = useParams<{ id: string }>();
  const locationId = params?.id ?? "";

  const [location, setLocation] = useState<Location | null>(null);
  const [history, setHistory] = useState<InventoryHistoryRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!locationId) return;
    (async () => {
      setError(null);
      try {
        const [loc, hist, prods, us] = await Promise.all([
          getLocation(locationId),
          getInventoryHistoryForLocation(locationId, 400),
          listProducts(),
          listUsers(),
        ]);
        setLocation(loc);
        setHistory(hist);
        setProducts(prods);
        setUsers(us);
      } catch (e: unknown) {
        setError(errorMessage(e, "History konnte nicht geladen werden."));
      }
    })();
  }, [locationId]);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return history;
    return history.filter((h) => {
      const p = productMap.get(h.product_id);
      const name = p?.name ?? "";
      return name.toLowerCase().includes(t);
    });
  }, [history, q, productMap]);

  return (
    <div className="flex-1 flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-zinc-600">History</div>
            <div className="text-xl font-extrabold leading-tight">
              {location?.name ?? "…"}
            </div>
          </div>
          <Link
            href={`/location/${locationId}`}
            className="text-sm font-semibold text-zinc-700"
          >
            Zurück
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-5">
        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div>
        ) : null}

        <div className="grid gap-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Produkt filtern…"
          />

          {filtered.map((h) => {
            const p = productMap.get(h.product_id);
            const userName = h.user_id ? userMap.get(h.user_id) : null;
            return (
              <div
                key={h.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-extrabold">{p?.name ?? "Produkt"}</div>
                  <div className="text-2xl font-extrabold tabular-nums">
                    {h.quantity}
                  </div>
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  {userName ? <span className="font-semibold">{userName}</span> : "?"}
                  {" · "}
                  {formatRelativeTime(h.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function formatRelativeTime(ts: string) {
  const d = new Date(ts).getTime();
  const diff = Date.now() - d;
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 30) return "gerade eben";
  if (sec < 90) return "vor 1 min";
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} h`;
  return new Date(ts).toLocaleString();
}

