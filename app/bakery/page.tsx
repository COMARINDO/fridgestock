"use client";

import Link from "next/link";
import { RequireAuth } from "@/app/_components/RequireAuth";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";
import { isBakeryEnabled } from "@/lib/flags";

export default function BakeryHomePage() {
  return (
    <RequireAuth>
      <BakeryHomeInner />
    </RequireAuth>
  );
}

function BakeryHomeInner() {
  const { location } = useAuth();
  const { isAdmin } = useAdmin();

  if (!isBakeryEnabled()) {
    return (
      <main className="w-full px-4 py-8 max-w-2xl mx-auto">
        <div className="rounded-3xl border-2 border-black bg-white p-5">
          <h1 className="text-2xl font-black text-black">Bäckerei</h1>
          <p className="mt-2 text-sm font-black text-black/70">
            Modul ist deaktiviert. Setze <code>NEXT_PUBLIC_ENABLE_BAKERY=true</code>.
          </p>
          <div className="mt-4">
            <Link
              href="/overview"
              className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black"
            >
              Zurück
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full px-4 py-6 pb-28 max-w-2xl mx-auto">
      <div className="rounded-3xl border-2 border-black bg-white p-5">
        <h1 className="text-2xl font-black text-black">Bäckerei</h1>
        <p className="mt-2 text-sm font-black text-black/65">
          Bestellungen der Filialen und Übersicht für die Backstube.
        </p>

        <div className="mt-5 grid gap-3">
          {location?.location_id ? (
            <Link
              href="/bakery/order"
              className="h-14 px-4 inline-flex items-center justify-between rounded-3xl bg-black text-white text-[16px] font-black active:scale-[0.99]"
            >
              <span>Bestellen (Filiale)</span>
              <span>→</span>
            </Link>
          ) : null}

          {isAdmin ? (
            <>
              <Link
                href="/bakery/form"
                className="h-14 px-4 inline-flex items-center justify-between rounded-3xl bg-black text-white text-[16px] font-black active:scale-[0.99]"
              >
                <span>Bestellformular (zentral)</span>
                <span>→</span>
              </Link>
              <Link
                href="/bakery/backstube"
                className="h-14 px-4 inline-flex items-center justify-between rounded-3xl border-2 border-black bg-white text-black text-[16px] font-black active:scale-[0.99]"
              >
                <span>Übersicht (Backstube)</span>
                <span>→</span>
              </Link>
            </>
          ) : null}

          <Link
            href="/overview"
            className="h-12 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-sm font-black text-black"
          >
            Zur Übersicht
          </Link>
        </div>
      </div>
    </main>
  );
}

