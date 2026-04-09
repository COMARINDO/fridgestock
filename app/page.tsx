"use client";

import Link from "next/link";
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
      <header className="sticky top-0 z-10 bg-[var(--background)]/90 backdrop-blur border-b border-black/10">
        <div className="w-full px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] text-[#1f1f1f]">Location</div>
              <div className="text-[18px] font-extrabold leading-tight">
                {activeParent?.parent.name ?? "…"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/overview"
                className="h-11 px-4 inline-flex items-center rounded-2xl border border-black/10 bg-white text-[15px] font-semibold"
              >
                Überblick
              </Link>
              <button
                onClick={() => logout()}
                className="h-11 px-4 inline-flex items-center rounded-2xl border border-black/10 bg-white text-[15px] font-semibold"
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
          <div className="mt-6 text-[#1f1f1f]">Lade…</div>
        ) : !activeParent ? (
          <div className="mt-6 text-[#1f1f1f]">
            Location nicht gefunden. Bitte erneut einloggen.
          </div>
        ) : (
          <div className="mt-2 grid gap-3">
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
                  className="block w-full max-w-full rounded-3xl border border-black/10 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[18px] font-extrabold truncate">{parent.name}</div>
                      <div className="mt-1 text-[15px] text-[#1f1f1f]">
                        Haupt-Location (Bestand hier)
                      </div>
                    </div>

                    {!hasChildren ? (
                      <Link
                        href={`/location/${parent.id}`}
                        className="h-11 px-4 inline-flex items-center rounded-2xl bg-[#6f4e37] text-white text-[15px] font-semibold active:scale-[0.99]"
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
                            <div className="text-[15px] font-extrabold text-[#1f1f1f]">
                              {s}
                            </div>
                            <div className="mt-2 grid gap-2">
                              {items.map((c) => (
                                <Link
                                  key={c.id}
                                  href={`/location/${c.id}`}
                                  className="block w-full rounded-3xl border border-black/10 bg-[#f5efe6] px-4 py-4 text-[17px] font-semibold active:scale-[0.99]"
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
