"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import { getGlobalOverviewByProduct } from "@/lib/db";
import type { Product } from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";

type Row = Product & { quantity: number };

export default function AdminPage() {
  const router = useRouter();
  const { isAdmin, exitAdmin, adminHydrated } = useAdmin();

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

  return (
    <AdminDashboard
      onExit={() => {
        exitAdmin();
        router.replace("/login");
      }}
    />
  );
}

function AdminDashboard({ onExit }: { onExit: () => void }) {
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

  return (
    <main className="w-full px-4 py-4 pb-28 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-black">Admin</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/orders"
            className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          >
            Bestellübersicht
          </Link>
          <Link
            href="/admin/bookings"
            className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          >
            Buchungen
          </Link>
          <Link
            href="/admin/inventory-sessions"
            className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
          >
            Inventur-Sessions
          </Link>
          <button
            type="button"
            disabled={backupBusy}
            className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99] disabled:opacity-50"
            onClick={() => void sendBackup()}
          >
            {backupBusy ? "Backup…" : "Backup senden"}
          </button>
          <button
            type="button"
            className="h-11 px-4 rounded-2xl border-2 border-black bg-white text-sm font-black text-black active:scale-[0.99]"
            onClick={onExit}
          >
            Admin-Modus beenden
          </button>
        </div>
      </div>

      {busy ? (
        <div className="mt-8 text-black font-black">Lade…</div>
      ) : err ? (
        <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div>
      ) : null}

      {!busy && !err ? (
        <div className="mt-6 overflow-x-auto rounded-3xl border-2 border-black bg-white">
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
      ) : null}
    </main>
  );
}
