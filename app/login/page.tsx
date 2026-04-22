"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
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
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Rosa Gradient-Background im Logo-Stil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(130%_80%_at_50%_0%,#ffd6e7_0%,#ffe4ee_35%,#fff4ea_85%)]"
      />
      {/* Soft-pink Blob-Glow hinter dem Logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-80px] -z-10 h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-pink-300/40 blur-3xl"
      />
      {/* Dekorative Sparkles / Blumen (dezent, pointer-events-none) */}
      <Sparkles />

      <div className="relative mx-auto flex w-full max-w-md flex-col items-center px-5 pt-10 pb-10">
        {/* Hero: Logo + Wortmarke */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-[36px] bg-pink-400/30 blur-2xl"
          />
          <div className="rounded-[36px] border-2 border-pink-300 bg-white/80 p-2 shadow-[0_20px_45px_-18px_rgba(236,72,153,0.55)] backdrop-blur">
            <Image
              src="/logo.png"
              alt="Orderella"
              width={192}
              height={192}
              priority
              className="h-[168px] w-[168px] rounded-[28px] object-contain sm:h-[184px] sm:w-[184px]"
            />
          </div>
        </div>

        <h1 className="mt-5 text-center text-[40px] font-black leading-none tracking-tight text-pink-600 drop-shadow-[0_2px_0_rgba(255,255,255,0.9)] sm:text-[44px]">
          Orderella
        </h1>
        <p className="mt-2 text-center text-[13px] font-black uppercase tracking-[0.22em] text-pink-700/70">
          Bäckerei · Bestellsystem
        </p>

        {/* Login-Karte */}
        <div className="relative mt-7 w-full">
          <div
            aria-hidden
            className="absolute -inset-1 -z-10 rounded-[32px] bg-gradient-to-br from-pink-200/70 via-rose-200/60 to-pink-300/70 blur-xl"
          />
          <div className="rounded-[28px] border-2 border-pink-300 bg-white/95 p-5 shadow-[0_18px_40px_-18px_rgba(236,72,153,0.35)] backdrop-blur-sm">
            <label
              htmlFor="login-code"
              className="mb-2 block text-center text-[11px] font-black uppercase tracking-[0.18em] text-pink-700/70"
            >
              Platzerl-Code
            </label>
            <input
              id="login-code"
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                setCode(next);
              }}
              placeholder="• • • •"
              inputMode="text"
              type="text"
              autoComplete="one-time-code"
              autoFocus
              disabled={codeLimit.locked}
              onKeyDown={(e) => {
                if (e.key === "Enter") onLogin();
              }}
              className={[
                "h-14 w-full rounded-2xl border-2 border-pink-300 bg-pink-50/60 px-4",
                "text-center text-[26px] font-black tracking-[0.35em] text-pink-900",
                "placeholder:text-pink-300 placeholder:tracking-[0.4em]",
                "outline-none transition-colors",
                "focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-300/40",
                "disabled:cursor-not-allowed disabled:opacity-60",
              ].join(" ")}
            />

            {codeLimit.locked ? (
              <div className="mt-3 rounded-2xl border-2 border-amber-500/40 bg-amber-50 px-4 py-3 text-[15px] font-bold text-amber-900">
                Zu viele fehlgeschlagene Versuche. Eingabe gesperrt für{" "}
                <span className="font-black tabular-nums">
                  {formatLockRemaining(lockRemainingDisplayMs)}
                </span>{" "}
                (mm:ss).
              </div>
            ) : null}

            {error ? (
              <div
                className="mt-3 rounded-2xl border-2 border-rose-400/60 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-900"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={onLogin}
              disabled={!code.trim() || codeLimit.locked}
              className={[
                "group relative mt-4 flex h-14 w-full items-center justify-center overflow-hidden rounded-2xl",
                "border-2 border-pink-700/80 bg-gradient-to-b from-pink-400 via-pink-500 to-rose-500",
                "text-[18px] font-extrabold tracking-wide text-white",
                "shadow-[0_8px_0_-2px_rgba(190,24,93,0.7),0_14px_30px_-12px_rgba(236,72,153,0.6)]",
                "transition-all active:translate-y-[1px] active:shadow-[0_5px_0_-2px_rgba(190,24,93,0.7),0_8px_18px_-10px_rgba(236,72,153,0.5)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              ].join(" ")}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent"
              />
              <span className="relative">Login</span>
            </button>
          </div>
        </div>

        {/* Zusatz-Aktionen */}
        <div className="mt-6 w-full space-y-3">
          <Link
            href="/order"
            className={[
              "group block w-full rounded-2xl border-2 border-pink-500 bg-white px-5 py-4",
              "text-center text-[16px] font-extrabold text-pink-700",
              "shadow-[0_6px_0_-2px_rgba(236,72,153,0.45),0_10px_24px_-12px_rgba(236,72,153,0.4)]",
              "transition-transform hover:bg-pink-50 active:translate-y-[1px]",
            ].join(" ")}
          >
            <span className="mr-1.5" aria-hidden>
              🛒
            </span>
            Bestellung aufgeben
          </Link>
          <p className="-mt-1 text-center text-[12px] font-bold text-pink-700/60">
            Ohne Login · Produkt · Menge · Abholzeit
          </p>

          <a
            href="/Ordarella-Anleitung.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className={[
              "block w-full rounded-2xl border-2 border-pink-300 bg-white/80 px-5 py-3.5",
              "text-center text-[15px] font-extrabold text-pink-700/80",
              "shadow-[0_4px_0_-2px_rgba(236,72,153,0.25)] backdrop-blur-sm",
              "transition-transform hover:bg-white active:translate-y-[1px]",
            ].join(" ")}
          >
            <span className="mr-1.5" aria-hidden>
              📘
            </span>
            Anleitung (PDF)
          </a>
        </div>

        <p className="mt-8 text-center text-[11px] font-black uppercase tracking-[0.2em] text-pink-700/40">
          made with <span aria-hidden>💗</span> in Rabenstein
        </p>

        <nav
          aria-label="Rechtliches"
          className="mt-3 flex items-center justify-center gap-4 text-[11px] font-black uppercase tracking-[0.18em] text-pink-700/60"
        >
          <Link href="/datenschutz" className="hover:text-pink-700 hover:underline">
            Datenschutz
          </Link>
          <span aria-hidden className="text-pink-700/30">·</span>
          <Link href="/impressum" className="hover:text-pink-700 hover:underline">
            Impressum
          </Link>
        </nav>
      </div>
    </div>
  );
}

/**
 * Dezente Hintergrund-Deko passend zum Logo (Sparkles / Blumen / Herzen).
 * Rein visuell, `aria-hidden` und `pointer-events-none`.
 */
function Sparkles() {
  const items: Array<{
    char: string;
    top: string;
    left: string;
    size: string;
    delay: string;
    opacity: string;
  }> = [
    { char: "✨", top: "8%", left: "8%", size: "28px", delay: "0s", opacity: "0.7" },
    { char: "🌸", top: "14%", left: "84%", size: "30px", delay: "0.4s", opacity: "0.8" },
    { char: "💗", top: "46%", left: "6%", size: "22px", delay: "0.8s", opacity: "0.65" },
    { char: "✨", top: "58%", left: "92%", size: "24px", delay: "1.2s", opacity: "0.55" },
    { char: "🌼", top: "78%", left: "12%", size: "26px", delay: "1.6s", opacity: "0.7" },
    { char: "⭐", top: "84%", left: "86%", size: "22px", delay: "0.2s", opacity: "0.55" },
    { char: "✨", top: "32%", left: "94%", size: "18px", delay: "1.0s", opacity: "0.5" },
    { char: "💖", top: "70%", left: "50%", size: "18px", delay: "1.4s", opacity: "0.35" },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {items.map((it, idx) => (
        <span
          key={idx}
          className="absolute select-none will-change-transform animate-pulse"
          style={{
            top: it.top,
            left: it.left,
            fontSize: it.size,
            opacity: Number(it.opacity),
            animationDelay: it.delay,
            animationDuration: "3.5s",
            filter: "drop-shadow(0 2px 6px rgba(236,72,153,0.35))",
          }}
        >
          {it.char}
        </span>
      ))}
    </div>
  );
}
