"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  clearAdminSession,
  readIsAdminFromStorage,
  setAdminSessionTrue,
  subscribeAdmin,
} from "@/lib/adminSession";

type AdminContextValue = {
  isAdmin: boolean;
  tryEnterWithCode: (code: string) => boolean;
  exitAdmin: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

const ADMIN_CODE = "1402";

let cachedIsAdmin: boolean | undefined = undefined;

function refreshCachedAdmin() {
  cachedIsAdmin = readIsAdminFromStorage();
}

function subscribe(cb: () => void) {
  const handler = () => {
    refreshCachedAdmin();
    cb();
  };
  return subscribeAdmin(handler);
}

function getSnapshot() {
  if (cachedIsAdmin === undefined) refreshCachedAdmin();
  return cachedIsAdmin ?? false;
}

function getServerSnapshot() {
  return false;
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<AdminContextValue>(
    () => ({
      isAdmin,
      tryEnterWithCode: (code: string) => {
        if (!verifyAdminCode(code)) return false;
        setAdminSessionTrue();
        cachedIsAdmin = true;
        return true;
      },
      exitAdmin: () => {
        clearAdminSession();
        cachedIsAdmin = false;
      },
    }),
    [isAdmin]
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
