"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useAdmin } from "@/app/admin-provider";

export function TopBar() {
  const router = useRouter();
  const { location, logout } = useAuth();
  const { isAdmin } = useAdmin();

  const homeHref = location?.location_id ? `/location/${location.location_id}` : "/";

  return (
    <div className="fixed top-0 left-0 right-0 z-50 border-b-2 border-black bg-[var(--background)]">
      <div className="w-full px-4 h-[120px] flex items-center">
        <div className="flex items-center justify-between gap-3 w-full">
          <Link
            href={homeHref}
            className="flex items-center gap-3 min-w-0 active:scale-[0.99]"
            aria-label="Bstand Home"
          >
            <Image
              src="/logo.png"
              alt="Bstand"
              width={110}
              height={110}
              priority
              className="h-[110px] w-[110px] aspect-square object-contain"
            />
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className={[
                "h-11 px-3 inline-flex items-center rounded-2xl border-2 border-black text-[13px] font-black active:scale-[0.99]",
                isAdmin ? "bg-emerald-200 text-black" : "bg-white/80 text-black/70",
              ].join(" ")}
            >
              Admin
            </Link>
            <Link
              href="/overview"
              className="h-11 px-4 inline-flex items-center rounded-2xl border-2 border-black bg-white text-[15px] font-black text-black active:scale-[0.99]"
            >
              Übersicht
            </Link>
            <button
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="h-11 px-4 inline-flex items-center rounded-2xl bg-black text-white text-[15px] font-black active:scale-[0.99]"
            >
              Abmelden
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

