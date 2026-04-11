"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clearStoredLocation,
  getStoredLocation,
  setStoredLocation,
} from "@/lib/auth";
import type { SessionLocation } from "@/lib/auth";

type AuthContextValue = {
  /** true after first client read of session storage (avoids SSR/client mismatch). */
  authHydrated: boolean;
  location: SessionLocation | null;
  setLocation: (l: SessionLocation | null) => void;
  logout: () => void; // clears selected location
};

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EVENT = "fridge-session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<SessionLocation | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);

  useEffect(() => {
    // localStorage only after mount — intentional sync from external store (hydration-safe).
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate session from storage once */
    setLocationState(getStoredLocation());
    setAuthHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const sync = () => setLocationState(getStoredLocation());
    window.addEventListener("storage", sync);
    window.addEventListener(SESSION_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SESSION_EVENT, sync as EventListener);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      authHydrated,
      location,
      setLocation: (l) => {
        if (l) setStoredLocation(l);
        else clearStoredLocation();
        setLocationState(l);
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
      logout: () => {
        clearStoredLocation();
        setLocationState(null);
        window.dispatchEvent(new Event(SESSION_EVENT));
      },
    };
  }, [authHydrated, location]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
