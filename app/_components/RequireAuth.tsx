"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { useAuth } from "@/app/providers";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { location, authHydrated } = useAuth();
  const { isAdmin, adminHydrated } = useAdmin();
  const router = useRouter();
  const pathname = usePathname();

  const sessionReady = authHydrated && adminHydrated;
  const allowed = Boolean(location) || isAdmin;

  useEffect(() => {
    if (!sessionReady) return;
    if (!allowed && pathname !== "/login") router.replace("/login");
  }, [allowed, pathname, router, sessionReady]);

  if (!sessionReady) return <div className="flex-1" />;

  if (!allowed) return <div className="flex-1" />;

  return <>{children}</>;
}
