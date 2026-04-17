"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";
import { getMissingCountsForLatestInventorySession, setInventoryQuantity } from "@/lib/db";
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

  async function logoutWithOptionalGuard() {
    const locId = location?.location_id ?? "";
    // If we don't have a concrete location context, just logout.
    if (!isLocationScreen || !locId.trim()) {
      exitAdmin();
      logout();
      router.replace("/login");
      return;
    }

    // Only show the guard if there is something missing.
    try {
      const missing = await getMissingCountsForLatestInventorySession({
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

    setGuardIntent(intent);
    setGuardBusy(true);
    setGuardErr(null);
    setGuardMissing([]);
    setGuardOpen(true);
    try {
      const missing = await getMissingCountsForLatestInventorySession({
        locationId: locId,
        gapHours: 5,
      });
      setGuardMissing(missing);
    } catch (e: unknown) {
      setGuardErr(errorMessage(e, "Konnte Inventur-Check nicht laden."));
      setGuardMissing([]);
    } finally {
      setGuardBusy(false);
    }
  }

  async function applyAllMissingAsZeroAndProceed() {
    const locId = location?.location_id ?? "";
    if (!locId.trim()) {
      // No location context -> just proceed.
      proceedGuardIntent();
      return;
    }
    if (guardMissing.length === 0) {
      proceedGuardIntent();
      return;
    }
    setGuardBusy(true);
    setGuardErr(null);
    try {
      for (const m of guardMissing) {
        await setInventoryQuantity({
          locationId: locId,
          productId: m.product_id,
          quantity: 0,
        });
      }
      proceedGuardIntent();
    } catch (e: unknown) {
      setGuardErr(errorMessage(e, "Auf 0 setzen fehlgeschlagen."));
    } finally {
      setGuardBusy(false);
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
  const btnMode =
    "h-10 px-3 rounded-2xl border-2 text-[14px] font-black transition-colors active:scale-[0.99]";

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-black bg-[var(--background)]">
      <div className="w-full px-4 py-3 min-h-[56px] flex items-center">
        {bareLoginScreen ? null : (
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 justify-start">
              <button
                type="button"
                onClick={() => {
                  void logoutWithOptionalGuard();
                }}
                className={btnDarkSmall}
              >
                Abmelden
              </button>
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
                <div className="text-xs text-black">Inventur-Check</div>
                <div className="text-2xl font-black leading-tight text-black">
                  Nicht gezählte Artikel
                </div>
                <div className="mt-1 text-sm font-black text-black/60">
                  {guardBusy
                    ? "Prüfe…"
                    : guardMissing.length > 0
                      ? `${guardMissing.length} Artikel wurden in dieser Inventur (5h-Session) nicht gezählt.`
                      : "Keine fehlenden Artikel gefunden."}
                </div>
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
              {guardMissing.length > 0 ? (
                <button
                  type="button"
                  className="h-14 w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50 bg-black text-white shadow-sm"
                  disabled={guardBusy}
                  onClick={() => void applyAllMissingAsZeroAndProceed()}
                >
                  Alle auf 0 setzen & weiter
                </button>
              ) : null}
              <button
                type="button"
                className="h-14 w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50 bg-[#f2d2b6] text-black border-2 border-black shadow-sm"
                disabled={guardBusy}
                onClick={() => {
                  // "Weiter inventieren" -> just close the modal.
                  setGuardOpen(false);
                  setGuardIntent(null);
                  setGuardMissing([]);
                  setGuardErr(null);
                }}
              >
                Weiter inventieren
              </button>
              {!guardBusy && guardMissing.length === 0 ? (
                <button
                  type="button"
                  className="h-14 w-full rounded-2xl px-5 py-4 text-[17px] font-extrabold leading-none active:scale-[0.99] disabled:opacity-50 bg-black text-white shadow-sm"
                  onClick={() => proceedGuardIntent()}
                >
                  Weiter
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

