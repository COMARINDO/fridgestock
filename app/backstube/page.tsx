"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { listLoginLocations } from "@/lib/db";
import { BACKSTUBE_CODE, BACKSTUBE_LOCATION_NAME } from "@/lib/backstubeCode";
import { parsePickupDay } from "@/lib/parsePickupDay";

type Status = "open" | "confirmed" | "forwarded" | "cancelled";

type Item = {
  id: string;
  product: string;
  quantity: number;
  name: string;
  phone: string;
  pickup_time: string;
  location_id: string;
  location_name: string;
  status: Status;
  notes: string | null;
  created_at: string;
};

type DayBucket = {
  key: string;
  isoDate: string | null;
  label: string;
  items: Item[];
  totalPieces: number;
};

const STATUS_LABEL: Record<Status, string> = {
  open: "Offen",
  confirmed: "Bestätigt",
  forwarded: "Weitergeleitet",
  cancelled: "Storniert",
};

function statusBadge(s: Status): string {
  if (s === "open") return "bg-amber-50 text-amber-900 border border-amber-700/20";
  if (s === "confirmed" || s === "forwarded")
    return "bg-emerald-50 text-emerald-900 border border-emerald-700/20";
  return "bg-zinc-100 text-black/60 border border-black/10";
}

function buildBuckets(items: Item[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const it of items) {
    const parsed = parsePickupDay(it.pickup_time);
    const key = parsed.isoDate ?? "__unknown__";
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        isoDate: parsed.isoDate,
        label: parsed.label,
        items: [],
        totalPieces: 0,
      };
      map.set(key, bucket);
    }
    bucket.items.push(it);
    bucket.totalPieces += Number.isFinite(it.quantity) ? it.quantity : 0;
  }
  return [...map.values()].sort((a, b) => {
    if (a.isoDate && b.isoDate) return a.isoDate.localeCompare(b.isoDate);
    if (a.isoDate && !b.isoDate) return -1;
    if (!a.isoDate && b.isoDate) return 1;
    return 0;
  });
}

export default function BackstubePage() {
  const router = useRouter();
  const { authHydrated, location, logout } = useAuth();

  const [allowedId, setAllowedId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!authHydrated) return;
    void (async () => {
      try {
        const all = await listLoginLocations();
        const back = all.find((l) => l.name === BACKSTUBE_LOCATION_NAME);
        setAllowedId(back?.id ?? null);
        if (!back) {
          setErr(
            "Backstube-Location existiert noch nicht. Bitte SQL-Migration ausführen."
          );
        }
      } catch (e: unknown) {
        setErr(
          e instanceof Error ? e.message : "Konnte Filialen nicht laden."
        );
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [authHydrated]);

  useEffect(() => {
    if (!authChecked) return;
    if (!location?.location_id || !allowedId || location.location_id !== allowedId) {
      router.replace("/login");
    }
  }, [authChecked, location?.location_id, allowedId, router]);

  const reload = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/backstube/orders", {
        cache: "no-store",
        headers: { "x-backstube-code": BACKSTUBE_CODE },
      });
      const data = (await res.json()) as { ok: boolean; items?: Item[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Fehler beim Laden.");
      setItems(data.items ?? []);
      setNow(new Date());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Konnte Bestellungen nicht laden.");
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!allowedId) return;
    if (!location?.location_id || location.location_id !== allowedId) return;
    void reload();
    const id = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(id);
  }, [authChecked, allowedId, location?.location_id, reload]);

  const buckets = useMemo(() => buildBuckets(items), [items]);

  if (!authChecked) {
    return (
      <div className="flex-1 flex items-center justify-center text-black/50">
        Lade…
      </div>
    );
  }

  if (!location?.location_id || !allowedId || location.location_id !== allowedId) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#fff7ee]">
      <header className="border-b border-black/10 bg-white px-4 sm:px-6 py-3 flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Ordarella"
          width={36}
          height={36}
          className="h-9 w-9 rounded-xl object-contain"
        />
        <div className="min-w-0 leading-tight">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-black/45">
            Backstube
          </div>
          <h1 className="text-[18px] sm:text-[20px] font-black tracking-tight">
            Bestellungen nach Abholtag
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={busy}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] font-black text-black hover:bg-black/[0.04] disabled:opacity-50"
          >
            {busy ? "…" : "Aktualisieren"}
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] font-black text-black hover:bg-black/[0.04]"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex-1 px-4 sm:px-6 py-5 space-y-5">
        {err ? (
          <div className="rounded-2xl border border-red-700/20 bg-red-50 px-4 py-3 text-[14px] font-bold text-red-900">
            {err}
          </div>
        ) : null}

        {!busy && buckets.length === 0 ? (
          <div className="rounded-2xl border border-black/10 bg-white px-4 py-8 text-center">
            <div className="text-[15px] font-extrabold text-black/70">
              Keine offenen Bestellungen
            </div>
            <div className="mt-1 text-[13px] text-black/45">
              Sobald Kunden im Chat bestellen, erscheinen sie hier.
            </div>
          </div>
        ) : null}

        {buckets.map((b) => (
          <section
            key={b.key}
            className="rounded-3xl border border-black/10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.04)] overflow-hidden"
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-black/10 px-4 py-3 sm:px-5 bg-black/[0.02]">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-black/45">
                  Abholtag
                </div>
                <div className="text-[17px] font-black tracking-tight text-black">
                  {b.label}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-black/45">
                  Summe Stück
                </div>
                <div className="text-[20px] font-black tabular-nums text-black">
                  {b.totalPieces}
                </div>
              </div>
            </div>

            <ul className="divide-y divide-black/[0.07]">
              {b.items.map((it) => (
                <li
                  key={it.id}
                  className="px-4 py-3 sm:px-5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex items-baseline gap-2 min-w-0 sm:flex-1">
                    <div className="rounded-lg bg-black px-2 py-0.5 text-[12px] font-black text-white tabular-nums">
                      {it.quantity}×
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-extrabold text-black truncate">
                        {it.product}
                      </div>
                      <div className="text-[12px] font-bold text-black/55 truncate">
                        {it.name} ·{" "}
                        <a
                          href={`tel:${it.phone}`}
                          className="underline decoration-dotted"
                        >
                          {it.phone}
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <span className="rounded-md bg-black/[0.04] px-2 py-0.5 text-[12px] font-black text-black/75">
                      {it.location_name}
                    </span>
                    <span className="text-[13px] font-bold text-black/70">
                      {it.pickup_time}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${statusBadge(
                        it.status
                      )}`}
                    >
                      {STATUS_LABEL[it.status]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="text-center text-[11px] font-bold text-black/40 pt-2">
          Stand: {now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })} ·
          aktualisiert sich automatisch alle 60 Sekunden ·{" "}
          <Link href="/order" className="underline">
            Kunden-Chat öffnen
          </Link>
        </div>
      </div>
    </div>
  );
}
