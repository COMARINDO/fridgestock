"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { errorMessage } from "@/lib/error";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";
import {
  adminBadgeNeutralClass,
  adminBadgeSuccessClass,
  adminBadgeWarnClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerSuccessClass,
  adminCardClass,
  adminCardHeadlineClass,
  adminDangerButtonClass,
  adminInputClass,
  adminMutedTextClass,
  adminPrimaryButtonClass,
  adminSectionTitleClass,
  adminTableClass,
  adminTableHeadCellClass,
  adminTableRowClass,
  adminTableShellClass,
} from "@/app/admin/_components/adminUi";

type Status = "open" | "confirmed" | "forwarded" | "cancelled";

type Item = {
  id: string;
  product: string;
  quantity: number;
  name: string;
  phone: string;
  pickup_time: string;
  location_id: string;
  status: Status;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABEL: Record<Status, string> = {
  open: "Offen",
  confirmed: "Bestätigt",
  forwarded: "Weitergeleitet",
  cancelled: "Storniert",
};

function badgeForStatus(s: Status): string {
  if (s === "open") return adminBadgeWarnClass;
  if (s === "confirmed" || s === "forwarded") return adminBadgeSuccessClass;
  return adminBadgeNeutralClass;
}

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminDsgvoPage() {
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
      </main>
    );
  }

  return <DsgvoTools />;
}

function DsgvoTools() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSearch() {
    setErr(null);
    setInfo(null);
    setItems(null);
    setSelected(new Set());
    if (!phone.trim() && !name.trim()) {
      setErr("Bitte Telefonnummer oder Name eingeben.");
      return;
    }
    setBusy(true);
    try {
      const adminCode = window.prompt("Admin-Code", "") ?? "";
      if (!adminCode.trim()) {
        setBusy(false);
        return;
      }
      const res = await fetch("/api/admin/dsgvo/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminCode, phone: phone.trim(), name: name.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        items?: Item[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || "Suche fehlgeschlagen.");
      setItems(data.items ?? []);
      setInfo(
        `${data.items?.length ?? 0} Einträge gefunden. Zum Löschen Einträge auswählen oder per Telefonnummer alle auf einmal löschen.`
      );
    } catch (e: unknown) {
      setErr(errorMessage(e, "Suche fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  async function runDeleteSelected() {
    if (selected.size === 0) {
      setErr("Bitte mindestens einen Eintrag auswählen.");
      return;
    }
    const confirmed = window.confirm(
      `Wirklich ${selected.size} Eintrag/Einträge unwiderruflich löschen?`
    );
    if (!confirmed) return;
    await doDelete({ ids: Array.from(selected) });
  }

  async function runDeleteAllForPhone() {
    const p = phone.trim();
    if (!p) {
      setErr("Telefonnummer angeben, um alle zugehörigen Bestellungen zu löschen.");
      return;
    }
    const confirmed = window.confirm(
      `Wirklich ALLE Bestellungen mit Telefonnummer "${p}" löschen?`
    );
    if (!confirmed) return;
    await doDelete({ phone: p });
  }

  async function doDelete(payload: { ids?: string[]; phone?: string }) {
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const adminCode = window.prompt("Admin-Code für Löschung", "") ?? "";
      if (!adminCode.trim()) {
        setBusy(false);
        return;
      }
      const res = await fetch("/api/admin/dsgvo/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adminCode,
          ...payload,
          reason: reason.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        deleted_count?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || "Löschung fehlgeschlagen.");
      setInfo(
        `${data.deleted_count ?? 0} Eintrag/Einträge erfolgreich gelöscht.`
      );
      setItems(null);
      setSelected(new Set());
    } catch (e: unknown) {
      setErr(errorMessage(e, "Löschung fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6">
      <AdminPageHeader
        eyebrow="Rechtliches"
        title="DSGVO · Kundendaten"
        description="Auskunft (Art. 15) und Löschung (Art. 17) von Kundenbestellungen. Jede Aktion wird im Audit-Log protokolliert."
      />

      <section className={`${adminCardClass} mt-5`}>
        <p className={adminSectionTitleClass}>Suche</p>
        <h2 className={`${adminCardHeadlineClass} mt-1`}>
          Bestellungen einer Person finden
        </h2>
        <p className={`mt-1 ${adminMutedTextClass}`}>
          Telefonnummer oder Name eingeben (Teil-Treffer, case-insensitiv).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-black/55">
              Telefonnummer
            </label>
            <input
              type="tel"
              className={adminInputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="z. B. +43 660 1234567"
              disabled={busy}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-black/55">
              Name
            </label>
            <input
              type="text"
              className={adminInputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vor- oder Nachname"
              disabled={busy}
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-[11px] font-black uppercase tracking-wider text-black/55">
            Grund / Notiz (optional, wird im Audit-Log gespeichert)
          </label>
          <input
            type="text"
            className={adminInputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder='z. B. "Löschanfrage per E-Mail vom 20.04.2026"'
            disabled={busy}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={adminPrimaryButtonClass}
            onClick={() => void runSearch()}
            disabled={busy}
          >
            {busy ? "…" : "Suchen"}
          </button>
          <button
            type="button"
            className={adminDangerButtonClass}
            onClick={() => void runDeleteAllForPhone()}
            disabled={busy || !phone.trim()}
            title="Alle Einträge mit dieser Telefonnummer unwiderruflich löschen."
          >
            Alle zur Telefonnummer löschen
          </button>
        </div>
      </section>

      {err ? <div className={`${adminBannerErrorClass} mt-4`}>{err}</div> : null}
      {info ? <div className={`${adminBannerSuccessClass} mt-4`}>{info}</div> : null}

      {items !== null ? (
        <section className={`${adminCardClass} mt-5`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className={adminSectionTitleClass}>Ergebnis</p>
              <h2 className={`${adminCardHeadlineClass} mt-1`}>
                {items.length} Einträge
              </h2>
            </div>
            {items.length > 0 ? (
              <button
                type="button"
                className={adminDangerButtonClass}
                onClick={() => void runDeleteSelected()}
                disabled={busy || selected.size === 0}
                title="Markierte Einträge unwiderruflich löschen."
              >
                Auswahl löschen ({selected.size})
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className={`${adminBannerInfoClass} mt-4`}>
              Keine Treffer. Bitte Schreibweise prüfen.
            </div>
          ) : (
            <div className={`${adminTableShellClass} mt-4`}>
              <table className={adminTableClass}>
                <thead>
                  <tr>
                    <th className={`${adminTableHeadCellClass} w-10`}></th>
                    <th className={adminTableHeadCellClass}>Erstellt</th>
                    <th className={adminTableHeadCellClass}>Status</th>
                    <th className={adminTableHeadCellClass}>Name</th>
                    <th className={adminTableHeadCellClass}>Telefon</th>
                    <th className={adminTableHeadCellClass}>Produkt</th>
                    <th className={adminTableHeadCellClass}>Abholzeit</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const checked = selected.has(it.id);
                    return (
                      <tr key={it.id} className={adminTableRowClass}>
                        <td className="p-3 align-middle">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSel(it.id)}
                            aria-label="Eintrag auswählen"
                          />
                        </td>
                        <td className="p-3 align-middle text-[13px] font-bold text-black/70 tabular-nums">
                          {fmtTs(it.created_at)}
                        </td>
                        <td className="p-3 align-middle">
                          <span className={badgeForStatus(it.status)}>
                            {STATUS_LABEL[it.status]}
                          </span>
                        </td>
                        <td className="p-3 align-middle font-bold">{it.name}</td>
                        <td className="p-3 align-middle tabular-nums">{it.phone}</td>
                        <td className="p-3 align-middle">
                          {it.quantity}× {it.product}
                        </td>
                        <td className="p-3 align-middle text-[13px]">
                          {it.pickup_time}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className={`${adminCardClass} mt-5`}>
        <p className={adminSectionTitleClass}>Automatische Löschung</p>
        <h2 className={`${adminCardHeadlineClass} mt-1`}>
          Ablaufende Aufbewahrungsfristen
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] font-bold text-black/75">
          <li>
            Abgeschlossene / stornierte Kundenbestellungen: automatische
            Löschung nach 90 Tagen.
          </li>
          <li>
            Offene Kundenbestellungen: automatische Löschung nach 180 Tagen.
          </li>
          <li>Admin-Audit-Log: automatische Löschung nach 180 Tagen.</li>
        </ul>
        <p className={`mt-2 ${adminMutedTextClass}`}>
          Cron läuft täglich um 02:30 (siehe vercel.json). SQL-Funktionen:{" "}
          <code>supabase/dsgvo_cleanup.sql</code>.
        </p>
      </section>
    </main>
  );
}
