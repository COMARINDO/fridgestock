"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ADMIN_CODE } from "@/lib/adminCode";
import {
  clearAdminSession,
  readIsAdminFromStorage,
  setAdminSessionTrue,
  subscribeAdmin,
} from "@/lib/adminSession";

type AdminContextValue = {
  /** true after first client read of admin flag in storage (avoids SSR/client mismatch). */
  adminHydrated: boolean;
  isAdmin: boolean;
  tryEnterWithCode: (code: string) => boolean;
  exitAdmin: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminHydrated, setAdminHydrated] = useState(false);

  useEffect(() => {
    // localStorage only after mount — intentional sync from external store (hydration-safe).
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate admin flag from storage once */
    setIsAdmin(readIsAdminFromStorage());
    setAdminHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    return subscribeAdmin(() => setIsAdmin(readIsAdminFromStorage()));
  }, []);

  const value = useMemo<AdminContextValue>(
    () => ({
      adminHydrated,
      isAdmin,
      tryEnterWithCode: (code: string) => {
        if (!verifyAdminCode(code)) return false;
        setAdminSessionTrue();
        setIsAdmin(true);
        return true;
      },
      exitAdmin: () => {
        clearAdminSession();
        setIsAdmin(false);
      },
    }),
    [adminHydrated, isAdmin]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

export function verifyAdminCode(input: string): boolean {
  return input.trim() === ADMIN_CODE;
}
