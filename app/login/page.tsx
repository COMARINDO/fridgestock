"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Button } from "@/app/_components/ui";
import { listLocations } from "@/lib/db";
import { useAuth } from "@/app/providers";
import { errorMessage } from "@/lib/error";
import type { Location } from "@/lib/types";

const accessMap: Record<string, string> = {
  "3200": "Teich",
  "3202": "Hofstetten",
  "3203": "Rabenstein",
  "3204": "Kirchberg",
};

export default function LoginPage() {
  const router = useRouter();
  const { location, setLocation } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = location?.location_id;
    if (!id) return;
    router.replace(`/location/${id}`);
  }, [location?.location_id, router]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listLocations();
        setLocations(all.filter((l) => !l.parent_id));
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Platzerl nicht laden."));
      }
    })();
  }, []);

  const sorted = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  async function onLogin() {
    setError(null);
    try {
      const c = code.trim();
      if (!c) {
        setError("Ungültiger Code");
        return;
      }
      const locationName = accessMap[c];
      if (!locationName) {
        setError("Ungültiger Code");
        return;
      }
      const target = sorted.find(
        (l) => l.name.trim().toLowerCase() === locationName.trim().toLowerCase()
      );
      if (!target) {
        setError("Ungültiger Code");
        return;
      }
      try {
        navigator.vibrate?.(40);
      } catch {}
      setLocation({ location_id: target.id });
      router.replace(`/location/${target.id}`);
    } catch (e: unknown) {
      setError(errorMessage(e, "Login fehlgeschlagen."));
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="w-full px-4 pt-6">
        <div className="rounded-3xl border-2 border-black bg-white p-5 shadow-sm">
          <Input
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d]/g, "");
              setCode(next);
            }}
            placeholder="Code eingeben"
            inputMode="numeric"
            type="tel"
            autoComplete="one-time-code"
            autoFocus
            className="h-14 text-[22px] font-black text-center tracking-widest"
            onKeyDown={(e) => {
              if (e.key === "Enter") onLogin();
            }}
          />

          {error ? (
            <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[15px] text-red-800">
              {error}
            </div>
          ) : null}

          <Button
            className="mt-4 h-14 text-lg"
            onClick={onLogin}
            disabled={!code.trim()}
          >
            Login
          </Button>
        </div>
      </div>
    </div>
  );
}

