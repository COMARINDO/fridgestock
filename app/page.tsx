"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const { location } = useAuth();
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = location?.location_id;
    if (!id) return;
    router.replace(`/location/${encodeURIComponent(id)}`);
  }, [location?.location_id, router]);

  useEffect(() => {
    (async () => {
      setBusy(true);
      setError(null);
      try {
        setLocations(await listLocations());
      } catch (e: unknown) {
        setError(errorMessage(e, "Konnte Platzerl nicht laden."));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const main = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  // Normal flow: logged-in users have an assigned location and are redirected.
  if (location?.location_id) {
    return (
      <div className="flex-1 flex flex-col">
        <main className="w-full px-4 py-6">
          <div className="text-black font-black">Weiterleitung…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <main className="w-full px-4 py-4 pb-10">
        {error ? (
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">
            {error}
          </div>
        ) : null}

        {busy ? (
          <div className="mt-6 text-black">Lade…</div>
        ) : main.length === 0 ? (
          <div className="mt-6 text-black">Keine Platzerl gefunden.</div>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {main.map((loc) => {
              const isAssigned = location?.location_id === loc.id;

              return (
                <div
                  key={loc.id}
                  className="block w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[18px] font-black truncate text-black">
                        {loc.name}
                      </div>
                      {!isAssigned ? (
                        <div className="mt-1 text-[13px] font-black text-black/70">
                          Nur Lesen
                        </div>
                      ) : null}
                    </div>

                    <Link
                      href={`/location/${loc.id}`}
                      className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
                    >
                      Öffnen
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

    </div>
  );
}
