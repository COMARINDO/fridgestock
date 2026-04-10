"use client";

import Link from "next/link";
import Image from "next/image";
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
  const { location, logout } = useAuth();
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

  const grouped = useMemo(() => {
    const parents = locations
      .filter((l) => !l.parent_id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const children = locations
      .filter((l) => !!l.parent_id)
      .sort((a, b) => a.name.localeCompare(b.name));

    const byParent = new Map<string, Location[]>();
    for (const c of children) {
      const pid = c.parent_id!;
      byParent.set(pid, [...(byParent.get(pid) ?? []), c]);
    }

    return parents.map((p) => ({
      parent: p,
      children: byParent.get(p.id) ?? [],
    }));
  }, [locations]);

  const activeParent = useMemo(() => {
    const id = location?.location_id;
    if (!id) return null;
    return grouped.find((g) => g.parent.id === id) ?? null;
  }, [grouped, location?.location_id]);

  function sectionLabel(name: string): "Kühlschrank" | "Lager" | "Andere" {
    const n = name.trim().toLowerCase();
    if (n.includes("kühlschrank") || n.includes("kuehlschrank")) return "Kühlschrank";
    if (n.includes("lager")) return "Lager";
    return "Andere";
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="sticky top-0 z-10 bg-[var(--background)] border-b-2 border-black">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Image src="/logo.png" alt="Bstand" width={36} height={36} />
              <div className="min-w-0">
                <div className="text-[13px] text-black">Location</div>
                <div className="text-[20px] font-black leading-tight text-black truncate">
                  {activeParent?.parent.name ?? "…"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/overview"
                className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-[15px] font-black text-black active:scale-[0.99]"
              >
                Überblick
              </Link>
              <button
                onClick={() => logout()}
                className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
              >
                Wechseln
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
          <div className="mt-6 text-black">Lade…</div>
        ) : !activeParent ? (
          <div className="mt-6 text-black">
            Location nicht gefunden. Bitte erneut einloggen.
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[activeParent].map(({ parent, children }) => {
              const sections = {
                "Kühlschrank": children.filter((c) => sectionLabel(c.name) === "Kühlschrank"),
                "Lager": children.filter((c) => sectionLabel(c.name) === "Lager"),
                "Andere": children.filter((c) => sectionLabel(c.name) === "Andere"),
              };

              const hasChildren = children.length > 0;

              return (
                <div
                  key={parent.id}
                  className="block w-full max-w-full rounded-3xl border-2 border-black bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[18px] font-black truncate text-black">
                        {parent.name}
                      </div>
                      <div className="mt-1 text-[15px] text-black">
                        Haupt-Location (Bestand hier)
                      </div>
                    </div>

                    {!hasChildren ? (
                      <Link
                        href={`/location/${parent.id}`}
                        className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
                      >
                        Öffnen
                      </Link>
                    ) : null}
                  </div>

                  {hasChildren ? (
                    <div className="mt-4 grid gap-4">
                      {(["Kühlschrank", "Lager", "Andere"] as const).map((s) => {
                        const items = sections[s];
                        if (items.length === 0) return null;
                        return (
                          <div key={s}>
                            <div className="text-[15px] font-black text-black">
                              {s}
                            </div>
                            <div className="mt-2 grid gap-2">
                              {items.map((c) => (
                                <Link
                                  key={c.id}
                                  href={`/location/${c.id}`}
                                  className="block w-full rounded-3xl border-2 border-black bg-white px-4 py-4 text-[17px] font-black text-black active:scale-[0.99]"
                                >
                                  {c.name}
                                </Link>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </main>

    </div>
  );
}
