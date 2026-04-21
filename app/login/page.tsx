"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Input, Button } from "@/app/_components/ui";
import { listLoginLocations } from "@/lib/db";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";
import { errorMessage } from "@/lib/error";
import type { Location } from "@/lib/types";
import { BACKSTUBE_CODE, BACKSTUBE_LOCATION_NAME } from "@/lib/backstubeCode";
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
  [BACKSTUBE_CODE]: BACKSTUBE_LOCATION_NAME,
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
    const loc = locations.find((l) => l.id === id);
    if (loc?.name === BACKSTUBE_LOCATION_NAME) {
      router.replace("/backstube");
      return;
    }
    router.replace(`/location/${id}`);
  }, [location?.location_id, router, locations]);

  useEffect(() => {
    (async () => {
      try {
        const all = await listLoginLocations();
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
      if (target.name === BACKSTUBE_LOCATION_NAME) {
        router.replace("/backstube");
      } else {
        router.replace(`/location/${target.id}`);
      }
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
              const next = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
              setCode(next);
            }}
            placeholder="Code eingeben"
            inputMode="text"
            type="text"
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

        <div className="mt-6">
          <Link
            href="/order"
            className="block w-full rounded-3xl border-2 border-black bg-[#f2d2b6] px-5 py-5 text-center text-[18px] font-extrabold text-black shadow-sm hover:bg-[#eec79e] active:scale-[0.99]"
          >
            Bestellung aufgeben
          </Link>
          <p className="mt-2 text-center text-[13px] text-black/55">
            Schnell und ohne Login: Produkt, Menge, Abholzeit – fertig.
          </p>
        </div>

        <div className="mt-4">
          <a
            href="/Ordarella-Anleitung.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-3xl border-2 border-black bg-white px-5 py-4 text-center text-[16px] font-extrabold text-black shadow-sm hover:bg-black/[0.04] active:scale-[0.99]"
          >
            📘 Anleitung (PDF)
          </a>
          <p className="mt-2 text-center text-[13px] text-black/55">
            Kurz erklärt: so funktioniert Ordarella.
          </p>
        </div>

        <div className="mt-10 flex justify-center pb-6">
          <Image
            src="/logo.png"
            alt="Ordarella"
            width={160}
            height={160}
            priority
            className="h-[140px] w-[140px] rounded-3xl object-contain shadow-[0_8px_24px_-12px_rgba(236,72,153,0.45)]"
          />
        </div>
      </div>
    </div>
  );
}

