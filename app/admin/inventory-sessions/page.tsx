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
import { Button, ButtonSecondary } from "@/app/_components/ui";
import { formatProductName } from "@/lib/formatProductName";

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

type ProductLike = {
  brand?: string | null;
  product_name?: string | null;
  zusatz?: string | null;
};

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
      const main = locations.filter((l) => !l.parent_id).sort((a, b) => a.name.localeCompare(b.name, "de"));
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

  const activeLoc = useMemo(() => locs.find((l) => l.id === activeLocId) ?? null, [locs, activeLocId]);
  const activeSession = useMemo(
    () => sessions.find((s) => s.session_no === activeSessionNo) ?? null,
    [sessions, activeSessionNo]
  );

  async function setMissingToZero(productId: string) {
    void productId;
  }

  async function setAllMissingToZero() {
    // Removed: bulk destructive actions.
  }

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
    <main className="w-full px-4 py-4 pb-28 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-black">Inventur-Sessions</h1>
        <p className="mt-1 text-sm text-black/65">
          Session-Erkennung: <strong>5 Stunden Pause</strong> starten neue Inventur.
        </p>
      </div>

      {busy ? <div className="mt-8 text-black font-black">Lade…</div> : null}
      {err ? <div className="mt-6 rounded-3xl bg-red-50 p-4 text-red-800">{err}</div> : null}

      {!busy ? (
        <div className="mt-6 rounded-3xl border-2 border-black bg-white p-4">
          <div className="text-sm font-black text-black">Platzerl</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {locs.map((l) => (
              <button
                key={l.id}
                type="button"
                className={[
                  "h-10 px-3 rounded-2xl border-2 text-sm font-black transition-colors active:scale-[0.99]",
                  activeLocId === l.id ? "border-black bg-black text-white" : "border-black bg-white text-black",
                ].join(" ")}
                onClick={() => setActiveLocId(l.id)}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!busy ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <section className="rounded-3xl border-2 border-black bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-black">Sessions</div>
                <div className="text-xs font-black text-black/50">
                  {activeLoc ? activeLoc.name : "—"}
                </div>
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl border-2 border-black bg-white text-xs font-black text-black active:scale-[0.99]"
                onClick={() => void reloadSessions()}
                disabled={detailBusy}
              >
                {detailBusy ? "…" : "Reload"}
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="mt-4 text-sm font-black text-black/60">Noch keine Sessions.</div>
            ) : (
              <div className="mt-4 space-y-2">
                {sessions.map((s) => (
                  <button
                    key={s.session_no}
                    type="button"
                    className={[
                      "w-full text-left rounded-2xl border-2 px-3 py-3 active:scale-[0.99]",
                      activeSessionNo === s.session_no ? "border-black bg-black text-white" : "border-black bg-white text-black",
                    ].join(" ")}
                    onClick={() => setActiveSessionNo(s.session_no)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black truncate">
                          Session #{s.session_no}
                        </div>
                        <div className={activeSessionNo === s.session_no ? "text-xs font-black text-white/70" : "text-xs font-black text-black/60"}>
                          {fmtTs(s.started_at)} – {fmtTs(s.ended_at)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs font-black tabular-nums">
                          {s.distinct_products} Produkte
                        </div>
                        <div className={activeSessionNo === s.session_no ? "text-[11px] font-black text-white/70 tabular-nums" : "text-[11px] font-black text-black/60 tabular-nums"}>
                          {s.count_rows} Counts
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border-2 border-black bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-black">Details</div>
                <div className="text-xs font-black text-black/50">
                  {activeSession ? `Session #${activeSession.session_no}` : "—"}
                </div>
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl border-2 border-black bg-white text-xs font-black text-black active:scale-[0.99]"
                onClick={() => void reloadDetails()}
                disabled={detailBusy || activeSessionNo == null}
              >
                {detailBusy ? "…" : "Reload"}
              </button>
            </div>

            {detailBusy ? <div className="mt-4 text-black font-black">Lade…</div> : null}

            {!detailBusy && activeSessionNo != null ? (
              <>
                <div className="mt-4 rounded-2xl border-2 border-black/10 bg-black/[0.02] p-3">
                  <div className="text-xs font-black text-black/60">Gezählt in Session</div>
                  <div className="text-lg font-black text-black tabular-nums">{snapshot.length}</div>
                </div>

                <div className="mt-3 rounded-2xl border-2 border-amber-800/30 bg-amber-50 p-3">
                  <div className="text-xs font-black text-amber-900/70">⚠️ Nicht gezählt (vs vorige Inventur)</div>
                  <div className="text-lg font-black text-amber-950 tabular-nums">
                    {missing.filter((m) => !ignoredMissing[m.product_id]).length}
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <ButtonSecondary
                      className="h-11 text-sm"
                      disabled={detailBusy}
                      onClick={() => setIgnoredMissing({})}
                    >
                      Ignorieren zurücksetzen
                    </ButtonSecondary>
                  </div>
                </div>

                {missing.filter((m) => !ignoredMissing[m.product_id]).length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {missing
                      .filter((m) => !ignoredMissing[m.product_id])
                      .map((m) => {
                        const pseudo: ProductLike = {
                          brand: m.brand,
                          product_name: m.product_name,
                          zusatz: m.zusatz,
                        };
                        return (
                          <li
                            key={m.product_id}
                            className="rounded-2xl border-2 border-amber-900/20 bg-white px-3 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-black text-black truncate">
                                  {formatProductName(pseudo as any)}
                                </div>
                                <div className="text-xs font-black text-black/60 tabular-nums">
                                  letzter Bestand: {m.last_quantity}
                                  {m.last_count_at ? ` · ${fmtTs(m.last_count_at)}` : ""}
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <button
                                  type="button"
                                  className="h-10 px-3 rounded-2xl border-2 border-black bg-white text-xs font-black text-black active:scale-[0.99]"
                                  onClick={() => setIgnoredMissing((cur) => ({ ...cur, [m.product_id]: true }))}
                                >
                                  Ignorieren
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                ) : (
                  <div className="mt-3 text-sm font-black text-black/60">
                    Keine fehlenden Produkte (oder alles ignoriert).
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 text-sm font-black text-black/60">
                Session auswählen…
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

