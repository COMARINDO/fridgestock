"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";
import { getMissingCountsForActiveInventorySession } from "@/lib/db";
import type { InventoryMissingCountRow } from "@/lib/types";
import { errorMessage } from "@/lib/error";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { location, logout, authHydrated } = useAuth();
  const { isAdmin, exitAdmin, adminHydrated } = useAdmin();

  const sessionReady = authHydrated && adminHydrated;
  const hasSession = Boolean(location?.location_id) || isAdmin;
  const bareLoginScreen = pathname === "/login" && (!sessionReady || !hasSession);
  const isLocationScreen = pathname.startsWith("/location/");

  const [scanMode, setScanMode] = useState<"set" | "add">("set");

  const [guardOpen, setGuardOpen] = useState(false);
  const [guardBusy, setGuardBusy] = useState(false);
  const [guardErr, setGuardErr] = useState<string | null>(null);
  const [guardMissing, setGuardMissing] = useState<InventoryMissingCountRow[]>([]);
  const [guardIntent, setGuardIntent] = useState<null | "logout" | "switchToAdd">(null);

  useEffect(() => {
    if (!isLocationScreen) return;
    try {
      const raw = window.localStorage.getItem("fridge.scanMode.v1");
      if (raw === "set" || raw === "add") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe restore from localStorage
        setScanMode(raw);
      }
    } catch {
      // ignore
    }
  }, [isLocationScreen]);

  function formatMissingLabel(m: InventoryMissingCountRow): string {
    const brand = (m.brand ?? "").trim();
    const name = (m.product_name ?? "").trim();
    const zusatz = (m.zusatz ?? "").trim();
    return [brand, name].filter(Boolean).join(" - ") + (zusatz ? ` (${zusatz})` : "");
  }

  function formatLastInventoryAge(missing: InventoryMissingCountRow[]): string | null {
    const ts = missing
      .map((m) => (typeof m.last_count_at === "string" ? Date.parse(m.last_count_at) : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0];
    if (!ts) return null;
    const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
    if (days <= 0) return "Letzte Inventur: heute";
    if (days === 1) return "Letzte Inventur: gestern";
    return `Letzte Inventur: vor ${days} Tagen`;
  }

  async function logoutWithOptionalGuard() {
    const locId = location?.location_id ?? "";
    // Only guard when leaving an active inventory session (Inventur mode).
    if (!isLocationScreen || !locId.trim() || scanMode !== "set") {
      exitAdmin();
      logout();
      router.replace("/login");
      return;
    }

    // Only show the guard if there is something missing in the ACTIVE session.
    try {
      const missing = await getMissingCountsForActiveInventorySession({
        locationId: locId,
        gapHours: 5,
      });
      if (!missing || missing.length === 0) {
        exitAdmin();
        logout();
        router.replace("/login");
        return;
      }
      // Open modal only if we have missing items.
      setGuardIntent("logout");
      setGuardMissing(missing);
      setGuardErr(null);
      setGuardBusy(false);
      setGuardOpen(true);
    } catch (e: unknown) {
      // If the check fails, default to showing the guard (so user can decide).
      setGuardIntent("logout");
      setGuardMissing([]);
      setGuardErr(errorMessage(e, "Konnte Inventur-Check nicht laden."));
      setGuardBusy(false);
      setGuardOpen(true);
    }
  }

  async function openGuard(intent: "logout" | "switchToAdd") {
    const locId = location?.location_id ?? "";
    if (!isLocationScreen || !locId.trim()) {
      setGuardIntent(intent);
      setGuardMissing([]);
      setGuardErr(null);
      setGuardOpen(true);
      return;
    }

    try {
      const missing = await getMissingCountsForActiveInventorySession({
        locationId: locId,
        gapHours: 5,
      });
      // If nothing is missing, proceed immediately without showing a modal.
      if (!missing || missing.length === 0) {
        if (intent === "switchToAdd") {
          updateScanMode("add");
          return;
        }
        if (intent === "logout") {
          exitAdmin();
          logout();
          router.replace("/login");
          return;
        }
      }

      setGuardIntent(intent);
      setGuardBusy(false);
      setGuardErr(null);
      setGuardMissing(missing);
      setGuardOpen(true);
    } catch (e: unknown) {
      setGuardIntent(intent);
      setGuardErr(errorMessage(e, "Konnte Inventur-Check nicht laden."));
      setGuardMissing([]);
      setGuardBusy(false);
      setGuardOpen(true);
    }
  }

  function proceedGuardIntent() {
    const intent = guardIntent;
    setGuardOpen(false);
    setGuardIntent(null);
    setGuardMissing([]);
    setGuardErr(null);

    if (intent === "switchToAdd") {
      updateScanMode("add");
      return;
    }
    if (intent === "logout") {
      exitAdmin();
      logout();
      router.replace("/login");
    }
  }

  function updateScanMode(next: "set" | "add") {
    setScanMode(next);
    try {
      window.localStorage.setItem("fridge.scanMode.v1", next);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("fridge-scanmode"));
  }

  const btnDarkSmall =
    "h-10 px-3 inline-flex items-center rounded-2xl bg-black text-white text-[14px] font-black active:scale-[0.99]";
  const btnDangerSmall =
    "h-10 px-3 inline-flex items-center rounded-2xl bg-red-700 text-white text-[14px] font-black active:scale-[0.99]";
  const btnMode =
    "h-10 px-3 rounded-2xl border-2 text-[14px] font-black transition-colors active:scale-[0.99]";

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-black bg-[var(--background)]">
      <div className="w-full px-4 py-3 min-h-[56px] flex items-center">
        {bareLoginScreen ? null : (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 justify-start gap-2">
              <button
                type="button"
                onClick={() => {
                  void logoutWithOptionalGuard();
                }}
                className={btnDarkSmall}
              >
                Abmelden
              </button>
              {isLocationScreen ? (
                <button
                  type="button"
                  className={btnDangerSmall}
                  onClick={() => {
                    const locId = location?.location_id ?? "";
                    if (!locId.trim()) return;
                    router.push(`/location/${encodeURIComponent(locId)}/order`);
                  }}
                >
                  Bestellen
                </button>
              ) : null}
            </div>
            {isLocationScreen ? (
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  className={[
                    btnMode,
                    scanMode === "set"
                      ? "border-blue-700 bg-blue-700 text-white"
                      : "border-black bg-white text-black",
                  ].join(" ")}
                  onClick={() => updateScanMode("set")}
                >
                  Inventur
                </button>
                <button
                  type="button"
                  className={[
                    btnMode,
                    scanMode === "add"
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-black bg-white text-black",
                  ].join(" ")}
                  onClick={() => {
                    if (scanMode === "set") {
                      void openGuard("switchToAdd");
                      return;
                    }
                    updateScanMode("add");
                  }}
                >
                  Buchen
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 justify-end" />
            )}
          </div>
        )}
      </div>

      {guardOpen ? (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-end">
          <div className="w-full rounded-t-3xl bg-white p-5 border-t-2 border-black">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-black">Inventur-Hinweis</div>
                <div className="text-2xl font-black leading-tight text-black">
                  Nicht gezählte Artikel
                </div>
                <div className="mt-1 text-sm font-black text-black/60">
                  {guardBusy
                    ? "Prüfe…"
                    : guardMissing.length > 0
                      ? `Du hast ${guardMissing.length} Produkte von der letzten Inventur nicht gezählt.`
                      : "Keine fehlenden Artikel gefunden."}
                </div>
                {!guardBusy && guardMissing.length > 0 ? (
                  <div className="mt-1 text-xs font-black text-black/50">
                    {formatLastInventoryAge(guardMissing)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="h-10 px-3 rounded-2xl bg-white text-black text-sm font-black border-2 border-black active:scale-[0.99] shrink-0"
                onClick={() => {
                  setGuardOpen(false);
                  setGuardIntent(null);
                  setGuardMissing([]);
                  setGuardErr(null);
                }}
                disabled={guardBusy}
              >
                Schließen
              </button>
            </div>

            {guardErr ? (
              <div className="mt-4 rounded-3xl bg-red-50 p-4 text-red-800">{guardErr}</div>
            ) : null}

            {!guardBusy && guardMissing.length > 0 ? (
              <ul className="mt-4 max-h-[40vh] overflow-y-auto space-y-2">
                {guardMissing.slice(0, 30).map((m) => (
                  <li
                    key={m.product_id}
                    className="rounded-2xl border-2 border-amber-900/20 bg-amber-50 px-3 py-3"
                  >
                    <div className="text-sm font-black text-black">
                      {formatMissingLabel(m) || m.product_id}
                    </div>
                    <div className="text-xs font-black text-black/60 tabular-nums">
                      letzter Bestand: {m.last_quantity}
                    </div>
                  </li>
                ))}
                {guardMissing.length > 30 ? (
                  <li className="text-xs font-black text-black/60">
                    … und {guardMissing.length - 30} weitere
                  </li>
                ) : null}
              </ul>
            ) : null}

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                className="h-14 w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50 bg-[#f2d2b6] text-black border-2 border-black shadow-sm"
                disabled={guardBusy}
                onClick={() => {
                  // Weiter inventieren -> nur Modal schließen.
                  setGuardOpen(false);
                  setGuardIntent(null);
                  setGuardMissing([]);
                  setGuardErr(null);
                }}
              >
                Weiter inventieren
              </button>
              {!guardBusy ? (
                <button
                  type="button"
                  className="h-14 w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50 bg-black text-white shadow-sm"
                  onClick={() => proceedGuardIntent()}
                >
                  Ignorieren
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

