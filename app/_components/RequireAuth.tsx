"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { useAuth } from "@/app/providers";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { location } = useAuth();
  const { isAdmin } = useAdmin();
  const router = useRouter();
  const pathname = usePathname();

  const allowed = Boolean(location) || isAdmin;

  useEffect(() => {
    if (!allowed && pathname !== "/login") router.replace("/login");
  }, [allowed, router, pathname]);

  if (!allowed) return <div className="flex-1" />;

  return <>{children}</>;
}

