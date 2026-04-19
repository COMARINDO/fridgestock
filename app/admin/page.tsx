"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  adminActionSectionClass,
  adminReadSectionClass,
  adminSectionTitleClass,
} from "@/app/admin/_components/adminUi";
import { getGlobalOverviewByProduct } from "@/lib/db";
import type { Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";

type Row = Product & { quantity: number };

export default function AdminPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

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
        <p className="mt-2 text-sm text-black/60">Admin-Zugang erfolgt über die Login-Seite.</p>
      </main>
    );
  }

  return <AdminDashboard />;
}

function AdminDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const reload = useCallback(async () => {
    const data = await getGlobalOverviewByProduct();
    setRows(data);
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

  async function sendBackup() {
    setBackupBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminCode: window.prompt("Backup-Code eingeben") ?? "" }),
      });
      const raw = await res.text();
      let data: { ok?: boolean; error?: string };
      try {
        data = JSON.parse(raw) as { ok?: boolean; error?: string };
      } catch {
        throw new Error(
          raw.trim().slice(0, 300) || `Antwort ohne JSON (HTTP ${res.status})`
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      window.alert("Backup wurde gesendet");
    } catch (e: unknown) {
      setErr(errorMessage(e, "Backup konnte nicht gesendet werden."));
    } finally {
      setBackupBusy(false);
    }
  }

  const linkClass =
    "block rounded-2xl border-2 border-black bg-white px-4 py-3 text-sm font-black text-black transition-colors hover:bg-black/[0.04] active:scale-[0.99]";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-4">
      <h1 className="text-2xl font-black text-black">Admin – Übersicht</h1>
      <p className="mt-1 text-sm text-black/65">
        Wähle einen Bereich über die Navigation oben oder die Kurzlinks unten.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-1">
        <section className={adminReadSectionClass}>
          <h2 className={adminSectionTitleClass}>Monitoring</h2>
          <p className="mt-1 text-sm font-black text-black/70">
            Lesen: Bestände, Inventur-Fortschritt.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Link href="/admin" className={linkClass}>
              Übersicht (diese Seite)
            </Link>
            <Link href="/admin/inventory-sessions" className={linkClass}>
              Inventur-Sessions
            </Link>
          </div>
        </section>

        <section className={adminActionSectionClass}>
          <h2 className={adminSectionTitleClass}>Aktionen</h2>
          <p className="mt-1 text-sm font-black text-black/70">
            Schreiben: Bestellungen, Bedarf, später ggf. Transfers.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href="/admin/orders" className={`${linkClass} sm:inline-block sm:min-w-[200px]`}>
              Bestellungen
            </Link>
            <span
              className="inline-flex items-center justify-center rounded-2xl border border-dashed border-black/30 px-4 py-3 text-sm font-black text-black/45"
              title="Noch keine eigene Seite"
            >
              Transfers (geplant)
            </span>
            <button
              type="button"
              disabled={backupBusy}
              className="h-12 rounded-2xl border-2 border-black bg-white px-4 text-sm font-black text-black active:scale-[0.99] disabled:opacity-50 sm:ml-auto"
              onClick={() => void sendBackup()}
            >
              {backupBusy ? "Backup…" : "Backup senden"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border-2 border-black/20 bg-white p-4 sm:p-5">
          <h2 className={adminSectionTitleClass}>Debug / Historie</h2>
          <p className="mt-1 text-sm font-black text-black/70">
            Buchungsprotokoll und abgeschickte KW-Bestellungen.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Link href="/admin/bookings" className={linkClass}>
              Buchungen (History)
            </Link>
            <Link href="/admin/submitted-orders" className={linkClass}>
              Abgeschickte Bestellungen
            </Link>
          </div>
        </section>
      </div>

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err ? (
        <div className="mt-8">
          <h2 className="text-sm font-black uppercase tracking-wide text-black/70">
            Globale Bestände
          </h2>
          <p className="mt-1 text-xs font-black text-black/55">
            Summe Stück über alle Platzerl (Lesen).
          </p>
          <div className="mt-3 overflow-x-auto rounded-3xl border-2 border-black bg-white">
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead>
                <tr className="border-b-2 border-black bg-black/[0.03]">
                  <th className="p-3 font-black text-black">Produkt</th>
                  <th className="p-3 font-black text-black tabular-nums">Stk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-black/10 align-top">
                    <td className="p-3 font-black text-black max-w-[200px]">
                      {formatProductName(r)}
                    </td>
                    <td className="p-3 font-black tabular-nums">{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}
