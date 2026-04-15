"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";

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
                  exitAdmin();
                  logout();
                  router.replace("/login");
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
                  onClick={() => updateScanMode("add")}
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
    </div>
  );
}

