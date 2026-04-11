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

  const btnOutline =
    "h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-[15px] font-black text-black active:scale-[0.99]";
  const btnDark =
    "h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]";

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-black bg-[var(--background)]">
      <div className="w-full px-4 py-3 min-h-[56px] flex items-center">
        {bareLoginScreen ? null : (
          <div className="grid w-full grid-cols-3 items-center gap-2">
            <div className="flex min-w-0 justify-start">
              <button
                type="button"
                onClick={() => {
                  exitAdmin();
                  logout();
                  router.replace("/login");
                }}
                className={btnDark}
              >
                Abmelden
              </button>
            </div>
            <div className="flex min-w-0 justify-center">
              <Link href="/overview" className={btnOutline}>
                Übersicht
              </Link>
            </div>
            <div className="flex min-w-0 justify-end">
              <Link
                href={homeHref}
                className={btnOutline}
                aria-label="Dahoam"
              >
                Dahoam
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

