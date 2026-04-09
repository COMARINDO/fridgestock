"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { listLocations } from "@/lib/db";
import type { Location } from "@/lib/types";
import { useAuth } from "@/app/providers";
import { errorMessage } from "@/lib/error";

export default function HomePage() {
  return (
    <RequireAuth>
      <HomeInner />
    </RequireAuth>
  );
}

function HomeInner() {
  const { user, logout } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        setLocations(await listLocations());
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Locations nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-[var(--background)]/90 backdrop-blur border-b border-black/10">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-[#1f1f1f]">Eingeloggt als</div>
              <div className="text-[18px] font-extrabold leading-tight">
                {user?.name}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => logout()}
                className="h-11 px-4 inline-flex items-center rounded-2xl border border-black/10 bg-white text-[15px] font-semibold"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-4 pb-10">
        {error ? (
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">
            {error}
          </div>
        ) : null}

        {busy ? (
          <div className="mt-6 text-[#1f1f1f]">Lade…</div>
        ) : locations.length === 0 ? (
          <div className="mt-6 text-[#1f1f1f]">Keine Locations gefunden.</div>
        ) : (
          <div className="mt-2 grid gap-3">
            {locations.map((l) => (
              <Link
                key={l.id}
                href={`/location/${l.id}`}
                className="block w-full max-w-full rounded-3xl border border-black/10 bg-white p-4 shadow-sm active:scale-[0.99]"
              >
                <div className="text-[18px] font-extrabold">{l.name}</div>
                {l.parent_id ? (
                  <div className="mt-1 text-[15px] text-[#1f1f1f]">
                    Unter-Location
                  </div>
                ) : (
                  <div className="mt-1 text-[15px] text-[#1f1f1f]">Location</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>

    </div>
  );
}
