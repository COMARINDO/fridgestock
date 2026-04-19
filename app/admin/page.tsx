"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminCardClass,
  adminCardHeadlineClass,
  adminMutedTextClass,
  adminSecondaryButtonClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableHeadCellClass,
  adminTableRowClass,
  adminTableShellClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";
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

type QuickLink = {
  href: string;
  title: string;
  hint: string;
};

const monitoringLinks: QuickLink[] = [
  {
    href: "/admin/inventory-sessions",
    title: "Inventur-Sessions",
    hint: "Snapshots & nicht gezählte Artikel pro Platzerl.",
  },
];

const actionLinks: QuickLink[] = [
  {
    href: "/admin/orders?tab=demand",
    title: "Bestellungen",
    hint: "Bedarf, Lager, Hofstetten und Kirchberg.",
  },
];

const debugLinks: QuickLink[] = [
  {
    href: "/admin/bookings",
    title: "Buchungen",
    hint: "History aus inventory_history – inkl. Umbuchen.",
  },
  {
    href: "/admin/submitted-orders",
    title: "Abgeschickte Bestellungen",
    hint: "Bestellungen je KW – Lieferung bestätigen oder löschen.",
  },
];

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

  const totalPieces = rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6">
      <AdminPageHeader
        eyebrow="Übersicht"
        title="Bstand · Admin"
        description="Schneller Zugriff auf Bestände, Inventur, Bestellungen und Historie."
        actions={
          <button
            type="button"
            disabled={backupBusy}
            className={adminSecondaryButtonClass}
            onClick={() => void sendBackup()}
          >
            {backupBusy ? "Backup…" : "Backup senden"}
          </button>
        }
      />

      {err ? <div className={`${adminBannerErrorClass} mt-5`}>{err}</div> : null}

      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <QuickLinkCard
          eyebrow="Monitoring"
          title="Bestände & Inventur"
          links={monitoringLinks}
        />
        <QuickLinkCard
          eyebrow="Aktionen"
          title="Bestellprozess"
          links={actionLinks}
          accent="amber"
        />
        <QuickLinkCard
          eyebrow="Debug · Historie"
          title="Buchungen & Bestellungen"
          links={debugLinks}
        />
      </section>

      <section className={`${adminCardClass} mt-6`}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={adminSectionTitleClass}>Globale Bestände</p>
            <h2 className={adminCardHeadlineClass}>
              {rows.length} Produkte ·{" "}
              <span className="tabular-nums">{totalPieces}</span> Stück
            </h2>
            <p className={`mt-1 ${adminMutedTextClass}`}>
              Summe Stück über alle Platzerl (nur Lesen).
            </p>
          </div>
        </div>

        {busy ? (
          <div className={`${adminBannerInfoClass} mt-4`}>Lade…</div>
        ) : (
          <div className={`${adminTableShellClass} mt-4`}>
            <table className={`${adminTableClass} min-w-[360px]`}>
              <thead>
                <tr>
                  <th className={`${adminTableHeadCellClass} text-left`}>Produkt</th>
                  <th className={`${adminTableHeadCellClass} text-right tabular-nums`}>
                    Stück
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={adminTableRowClass}>
                    <td className="p-3 font-bold text-black">{formatProductName(r)}</td>
                    <td className="p-3 text-right font-black tabular-nums text-black">
                      {r.quantity}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-4 text-sm font-bold text-black/55" colSpan={2}>
                      Keine Daten.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function QuickLinkCard({
  eyebrow,
  title,
  links,
  accent,
}: {
  eyebrow: string;
  title: string;
  links: QuickLink[];
  accent?: "amber";
}) {
  const accentBorder = accent === "amber" ? "border-l-[3px] border-l-amber-500/70" : "";
  return (
    <section className={`${adminCardClass} ${accentBorder} flex flex-col`}>
      <p className={adminSectionTitleClass}>{eyebrow}</p>
      <h2 className={`${adminCardHeadlineClass} mt-1`}>{title}</h2>
      <div className="mt-3 flex flex-1 flex-col gap-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group flex items-start justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
          >
            <div className="min-w-0">
              <div className="text-sm font-black text-black">{l.title}</div>
              <div className="mt-0.5 text-[12px] font-bold text-black/55">{l.hint}</div>
            </div>
            <span
              aria-hidden
              className="shrink-0 rounded-md text-base text-black/30 transition-colors group-hover:text-black/60"
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
