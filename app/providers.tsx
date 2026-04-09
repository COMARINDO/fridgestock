"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { clearStoredUser, getStoredUser, setStoredUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";

type AuthContextValue = {
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EVENT = "fridge-session";

let cachedUser: SessionUser | null | undefined = undefined;

function readUserOnce() {
  if (cachedUser !== undefined) return cachedUser;
  cachedUser = getStoredUser();
  return cachedUser;
}

function refreshCachedUser() {
  cachedUser = getStoredUser();
}

function subscribe(cb: () => void) {
  const handler = () => {
    refreshCachedUser();
    cb();
  };

  window.addEventListener("storage", handler);
  window.addEventListener(SESSION_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SESSION_EVENT, handler as EventListener);
  };
}

function getSnapshot() {
  return readUserOnce();
}

function getServerSnapshot() {
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const user = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      setUser: (u) => {
        if (u) setStoredUser(u);
        else clearStoredUser();
        cachedUser = u;
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
      logout: () => {
        clearStoredUser();
        cachedUser = null;
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
    };
  }, [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

