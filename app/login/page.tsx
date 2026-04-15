"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Input, Button } from "@/app/_components/ui";
import { listLocations } from "@/lib/db";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";
import { errorMessage } from "@/lib/error";
import type { Location } from "@/lib/types";
import {
  clearCodeRateLimitOnSuccess,
  formatLockRemaining,
  recordFailedCodeAttempt,
  tickCodeRateLimitClock,
} from "@/lib/codeRateLimit";
import { useCodeRateLimit } from "@/app/useCodeRateLimit";

const accessMap: Record<string, string> = {
  "3200": "Teich",
  "3202": "Hofstetten",
  "3203": "Rabenstein",
  "32031": "Rabenstein Lager",
  "3204": "Kirchberg",
};

export default function LoginPage() {
  const router = useRouter();
  const { location, setLocation } = useAuth();
  const { tryEnterWithCode } = useAdmin();
  const codeLimit = useCodeRateLimit();
  const [lockRemainingMs, setLockRemainingMs] = useState(0);
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!codeLimit.locked || !codeLimit.lockUntil) return;
    const until = codeLimit.lockUntil;
    const tick = () => {
      tickCodeRateLimitClock();
      setLockRemainingMs(Math.max(0, until - Date.now()));
    };
    const raf = requestAnimationFrame(tick);
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, [codeLimit.locked, codeLimit.lockUntil]);

  const lockRemainingDisplayMs =
    codeLimit.locked && codeLimit.lockUntil ? lockRemainingMs : 0;

  useEffect(() => {
    const id = location?.location_id;
    if (!id) return;
    router.replace(`/location/${id}`);
  }, [location?.location_id, router]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listLocations();
        setLocations(all);
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
    if (codeLimit.locked) {
      setError(
        `Zu viele Versuche. Bitte ${formatLockRemaining(lockRemainingDisplayMs)} warten.`
      );
      return;
    }
    try {
      const c = code.trim();
      if (!c) {
        setError("Ungültiger Code");
        return;
      }
      if (tryEnterWithCode(c)) {
        clearCodeRateLimitOnSuccess();
        try {
          navigator.vibrate?.(40);
        } catch {}
        setLocation(null);
        setCode("");
        router.replace("/admin");
        return;
      }
      const locationName = accessMap[c];
      if (!locationName) {
        recordFailedCodeAttempt();
        setError("Ungültiger Code");
        return;
      }
      const target = sorted.find(
        (l) => l.name.trim().toLowerCase() === locationName.trim().toLowerCase()
      );
      if (!target) {
        recordFailedCodeAttempt();
        setError("Ungültiger Code");
        return;
      }
      clearCodeRateLimitOnSuccess();
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
            disabled={codeLimit.locked}
            className="h-14 text-[22px] font-black text-center tracking-widest"
            onKeyDown={(e) => {
              if (e.key === "Enter") onLogin();
            }}
          />

          {codeLimit.locked ? (
            <div className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
              Zu viele fehlgeschlagene Versuche. Eingabe gesperrt für{" "}
              <span className="font-black tabular-nums">
                {formatLockRemaining(lockRemainingDisplayMs)}
              </span>{" "}
              (mm:ss).
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[15px] text-red-800">
              {error}
            </div>
          ) : null}

          <Button
            className="mt-4 h-14 text-lg"
            onClick={onLogin}
            disabled={!code.trim() || codeLimit.locked}
          >
            Login
          </Button>
        </div>

        <div className="mt-10 flex justify-center pb-6">
          <Image
            src="/logo.png"
            alt="Bstand"
            width={110}
            height={110}
            className="h-[100px] w-[100px] object-contain"
          />
        </div>
      </div>
    </div>
  );
}

