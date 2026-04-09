"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  clearStoredLocation,
  getStoredLocation,
  setStoredLocation,
} from "@/lib/auth";
import type { SessionLocation } from "@/lib/auth";

type AuthContextValue = {
  location: SessionLocation | null;
  setLocation: (l: SessionLocation | null) => void;
  logout: () => void; // clears selected location
};

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EVENT = "fridge-session";

let cachedLocation: SessionLocation | null | undefined = undefined;

function readLocationOnce() {
  if (cachedLocation !== undefined) return cachedLocation;
  cachedLocation = getStoredLocation();
  return cachedLocation;
}

function refreshCachedLocation() {
  cachedLocation = getStoredLocation();
}

function subscribe(cb: () => void) {
  const handler = () => {
    refreshCachedLocation();
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
  return readLocationOnce();
}

function getServerSnapshot() {
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const location = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<AuthContextValue>(() => {
    return {
      location,
      setLocation: (l) => {
        if (l) setStoredLocation(l);
        else clearStoredLocation();
        cachedLocation = l;
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
      logout: () => {
        clearStoredLocation();
        cachedLocation = null;
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
    };
  }, [location]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

