"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/app/admin-provider";
import {
  getInventorySessionSnapshot,
  getMissingCountsForInventorySession,
  listInventoryCountSessions,
  listLocations,
} from "@/lib/db";
import type {
  InventoryCountSession,
  InventoryMissingCountRow,
  InventorySessionSnapshotRow,
  Location,
} from "@/lib/types";
import { errorMessage } from "@/lib/error";
import { formatProductName } from "@/lib/formatProductName";
import {
  adminBadgeNeutralClass,
  adminBannerErrorClass,
  adminBannerInfoClass,
  adminBannerWarnClass,
  adminCardClass,
  adminCardHeadlineClass,
  adminMutedTextClass,
  adminSecondaryButtonClass,
  adminSectionTitleClass,
} from "@/app/admin/_components/adminUi";
import { AdminPageHeader } from "@/app/admin/_components/AdminPageHeader";

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

export default function AdminInventorySessionsPage() {
  const router = useRouter();
  const { isAdmin, adminHydrated } = useAdmin();

  const [locs, setLocs] = useState<Location[]>([]);
  const [activeLocId, setActiveLocId] = useState<string>("");
  const [sessions, setSessions] = useState<InventoryCountSession[]>([]);
  const [activeSessionNo, setActiveSessionNo] = useState<number | null>(null);

  const [snapshot, setSnapshot] = useState<InventorySessionSnapshotRow[]>([]);
  const [missing, setMissing] = useState<InventoryMissingCountRow[]>([]);
  const [ignoredMissing, setIgnoredMissing] = useState<Record<string, boolean>>({});

  const [busy, setBusy] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!adminHydrated) return;
    if (!isAdmin) router.replace("/login");
  }, [adminHydrated, isAdmin, router]);

  const reload = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      const locations = await listLocations();
      const main = locations
        .filter((l) => !l.parent_id)
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
      setLocs(main);
      const first = main[0]?.id ?? "";
      setActiveLocId((cur) => cur || first);
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Orte nicht laden."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!adminHydrated || !isAdmin) return;
    void reload();
  }, [adminHydrated, isAdmin, reload]);

  const reloadSessions = useCallback(async () => {
    const lid = activeLocId.trim();
    if (!lid) return;
    setErr(null);
    setDetailBusy(true);
    try {
      const ss = await listInventoryCountSessions({ locationId: lid, gapHours: 5 });
      setSessions(ss);
      const newest = ss[0]?.session_no ?? null;
      setActiveSessionNo((cur) => (cur == null ? newest : cur));
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Sessions nicht laden."));
      setSessions([]);
      setActiveSessionNo(null);
    } finally {
      setDetailBusy(false);
    }
  }, [activeLocId]);

  useEffect(() => {
    if (!activeLocId) return;
    void reloadSessions();
    setSnapshot([]);
    setMissing([]);
    setIgnoredMissing({});
  }, [activeLocId, reloadSessions]);

  const reloadDetails = useCallback(async () => {
    const lid = activeLocId.trim();
    const sNo = activeSessionNo;
    if (!lid || sNo == null) return;
    setErr(null);
    setDetailBusy(true);
    try {
      const [snap, miss] = await Promise.all([
        getInventorySessionSnapshot({ locationId: lid, sessionNo: sNo, gapHours: 5 }),
        getMissingCountsForInventorySession({ locationId: lid, sessionNo: sNo, gapHours: 5 }),
      ]);
      setSnapshot(snap);
      setMissing(miss);
      setIgnoredMissing({});
    } catch (e: unknown) {
      setErr(errorMessage(e, "Konnte Session-Details nicht laden."));
      setSnapshot([]);
      setMissing([]);
      setIgnoredMissing({});
    } finally {
      setDetailBusy(false);
    }
  }, [activeLocId, activeSessionNo]);

  useEffect(() => {
    if (activeSessionNo == null) return;
    void reloadDetails();
  }, [activeSessionNo, reloadDetails]);

  const activeLoc = useMemo(
    () => locs.find((l) => l.id === activeLocId) ?? null,
    [locs, activeLocId]
  );
  const activeSession = useMemo(
    () => sessions.find((s) => s.session_no === activeSessionNo) ?? null,
    [sessions, activeSessionNo]
  );

  const visibleMissing = missing.filter((m) => !ignoredMissing[m.product_id]);

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
    <main className="w-full px-4 py-6 pb-28 max-w-5xl mx-auto">
      <AdminPageHeader
        eyebrow="Monitoring"
        title="Inventur-Sessions"
        description="Eine neue Session beginnt nach 5 Stunden Pause. Nicht gezählte Artikel zeigen, was sich seit der letzten Inventur nicht geändert hat."
      />

      {err ? <div className={`${adminBannerErrorClass} mt-5`}>{err}</div> : null}
      {busy ? <div className={`${adminBannerInfoClass} mt-5`}>Lade…</div> : null}

      {!busy ? (
        <section className={`${adminCardClass} mt-5`}>
          <p className={adminSectionTitleClass}>Platzerl auswählen</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {locs.map((l) => (
              <button
                key={l.id}
                type="button"
                className={[
                  "h-9 rounded-xl border px-3 text-sm font-black transition-colors active:scale-[0.99]",
                  activeLocId === l.id
                    ? "border-black bg-black text-white"
                    : "border-black/15 bg-white text-black hover:bg-black/[0.04]",
                ].join(" ")}
                onClick={() => setActiveLocId(l.id)}
              >
                {l.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!busy ? (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className={`${adminCardClass} flex flex-col`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={adminSectionTitleClass}>Sessions</p>
                <h2 className={`${adminCardHeadlineClass} mt-0.5 truncate`}>
                  {activeLoc?.name ?? "—"}
                </h2>
              </div>
              <button
                type="button"
                className={adminSecondaryButtonClass}
                onClick={() => void reloadSessions()}
                disabled={detailBusy}
              >
                {detailBusy ? "…" : "Neu laden"}
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className={`${adminBannerInfoClass} mt-4`}>Noch keine Sessions.</div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {sessions.map((s) => {
                  const isActive = activeSessionNo === s.session_no;
                  return (
                    <li key={s.session_no}>
                      <button
                        type="button"
                        className={[
                          "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                          isActive
                            ? "border-black bg-black text-white"
                            : "border-black/10 bg-white text-black hover:bg-black/[0.03]",
                        ].join(" ")}
                        onClick={() => setActiveSessionNo(s.session_no)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black truncate">
                              Session #{s.session_no}
                            </div>
                            <div
                              className={
                                isActive
                                  ? "mt-0.5 text-[11px] font-bold text-white/75"
                                  : "mt-0.5 text-[11px] font-bold text-black/55"
                              }
                            >
                              {fmtTs(s.started_at)} – {fmtTs(s.ended_at)}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs font-black tabular-nums">
                              {s.distinct_products} Produkte
                            </div>
                            <div
                              className={
                                isActive
                                  ? "text-[11px] font-bold tabular-nums text-white/75"
                                  : "text-[11px] font-bold tabular-nums text-black/55"
                              }
                            >
                              {s.count_rows} Counts
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={`${adminCardClass} flex flex-col`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={adminSectionTitleClass}>Details</p>
                <h2 className={`${adminCardHeadlineClass} mt-0.5 truncate`}>
                  {activeSession ? `Session #${activeSession.session_no}` : "—"}
                </h2>
              </div>
              <button
                type="button"
                className={adminSecondaryButtonClass}
                onClick={() => void reloadDetails()}
                disabled={detailBusy || activeSessionNo == null}
              >
                {detailBusy ? "…" : "Neu laden"}
              </button>
            </div>

            {detailBusy ? (
              <div className={`${adminBannerInfoClass} mt-4`}>Lade…</div>
            ) : null}

            {!detailBusy && activeSessionNo != null ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="Gezählt in Session" value={snapshot.length} />
                  <Stat
                    label="Nicht gezählt"
                    value={visibleMissing.length}
                    accent={visibleMissing.length > 0 ? "warn" : "neutral"}
                  />
                </div>

                {visibleMissing.length > 0 ? (
                  <>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <p className={adminMutedTextClass}>
                        Diese Produkte hatten zuletzt Bestand &gt; 0 und wurden in dieser
                        Session nicht erfasst.
                      </p>
                      <button
                        type="button"
                        className={adminSecondaryButtonClass}
                        disabled={detailBusy}
                        onClick={() => setIgnoredMissing({})}
                      >
                        Ignorieren zurücksetzen
                      </button>
                    </div>

                    <ul className="mt-3 flex flex-col gap-2">
                      {visibleMissing.map((m) => {
                        const pseudo = {
                          brand: m.brand ?? "",
                          product_name: m.product_name ?? "",
                          zusatz: m.zusatz ?? "",
                        };
                        return (
                          <li
                            key={m.product_id}
                            className="flex items-start justify-between gap-3 rounded-xl border border-amber-700/15 bg-amber-50 px-3 py-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-black text-black truncate">
                                {formatProductName(pseudo)}
                              </div>
                              <div className="text-[11px] font-bold tabular-nums text-black/60">
                                letzter Bestand: {m.last_quantity}
                                {m.last_count_at ? ` · ${fmtTs(m.last_count_at)}` : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={adminSecondaryButtonClass}
                              onClick={() =>
                                setIgnoredMissing((cur) => ({
                                  ...cur,
                                  [m.product_id]: true,
                                }))
                              }
                            >
                              Ignorieren
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <div className={`${adminBannerInfoClass} mt-4`}>
                    Keine fehlenden Produkte (oder alles ignoriert).
                  </div>
                )}
              </>
            ) : !detailBusy ? (
              <div className={`${adminBannerWarnClass} mt-4`}>
                Session links auswählen.
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "warn" | "neutral";
}) {
  const cls =
    accent === "warn"
      ? "border-amber-700/20 bg-amber-50"
      : "border-black/10 bg-zinc-50";
  return (
    <div className={`rounded-xl border ${cls} px-3 py-3`}>
      <div className={adminBadgeNeutralClass + " mb-2"}>{label}</div>
      <div className="text-2xl font-black tabular-nums leading-none text-black">
        {value}
      </div>
    </div>
  );
}
