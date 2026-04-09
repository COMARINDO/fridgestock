"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { location } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!location && pathname !== "/login") router.replace("/login");
  }, [location, router, pathname]);

  if (!location) return <div className="flex-1" />;

  return <>{children}</>;
}

