"use client";

import Link from "next/link";
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

  const homeHref = location?.location_id
    ? `/location/${location.location_id}`
    : isAdmin
      ? "/admin"
      : "/";

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-black bg-[var(--background)]">
      <div className="w-full px-4 py-3 min-h-[56px] flex items-center">
        <div className="flex items-center justify-between gap-3 w-full">
          {bareLoginScreen ? (
            <div className="h-11 px-1 inline-flex items-center text-[15px] font-black text-black">
              Bstand
            </div>
          ) : (
            <Link
              href={homeHref}
              className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-[15px] font-black text-black active:scale-[0.99]"
              aria-label="dahoam"
            >
              dahoam
            </Link>
          )}

          {!bareLoginScreen ? (
            <div className="flex items-center gap-2">
              <Link
                href="/overview"
                className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-[15px] font-black text-black active:scale-[0.99]"
              >
                Übersicht
              </Link>
              <button
                type="button"
                onClick={() => {
                  exitAdmin();
                  logout();
                  router.replace("/login");
                }}
                className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
              >
                Abmelden
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

