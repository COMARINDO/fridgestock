"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { Input } from "@/app/_components/ui";
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
  const [q, setQ] = useState("");
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

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return locations;
    return locations.filter((l) => l.name.toLowerCase().includes(t));
  }, [locations, q]);

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-[var(--background)]/90 backdrop-blur border-b border-black/10">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-[#2c2c2c]/70">Eingeloggt als</div>
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

          <div className="mt-4">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Location suchen…"
            />
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
          <div className="mt-6 text-[#2c2c2c]/70">Lade…</div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 text-[#2c2c2c]/70">Keine Locations gefunden.</div>
        ) : (
          <div className="mt-2 grid gap-3">
            {filtered.map((l) => (
              <Link
                key={l.id}
                href={`/location/${l.id}`}
                className="rounded-3xl border border-black/10 bg-white p-4 shadow-sm active:scale-[0.99]"
              >
                <div className="text-[18px] font-extrabold">{l.name}</div>
                {l.parent_id ? (
                  <div className="mt-1 text-[15px] text-[#2c2c2c]/70">
                    Unter-Location
                  </div>
                ) : (
                  <div className="mt-1 text-[15px] text-[#2c2c2c]/70">Location</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>

    </div>
  );
}
