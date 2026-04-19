"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { HOFSTETTEN_NAME, KIRCHBERG_NAME } from "@/lib/locationConstants";
import { useAiConsumptionToggle } from "@/lib/useAiConsumptionToggle";

const navLinkBase =
  "group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-black " +
  "transition-colors";
const navLinkIdle = "text-black/70 hover:bg-black/[0.04] hover:text-black";
const navLinkActive = "bg-black text-white shadow-[0_1px_0_0_rgba(0,0,0,0.1)]";

const subLinkBase =
  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-black " +
  "transition-colors";
const subLinkIdle = "text-black/65 hover:bg-black/[0.04] hover:text-black";
const subLinkActive = "bg-black/[0.06] text-black";

const groupTitleClass =
  "px-2 text-[10px] font-black uppercase tracking-[0.12em] text-black/40";

type NavItem = { href: string; label: string };

const monitoring: NavItem[] = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/inventory-sessions", label: "Inventur-Sessions" },
];

const actions: NavItem[] = [
  { href: "/admin/orders?tab=demand", label: "Bestellungen" },
];

const debug: NavItem[] = [
  { href: "/admin/bookings", label: "Buchungen" },
  { href: "/admin/submitted-orders", label: "Abgeschickte Bestellungen" },
];

function matchActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  const base = href.split("?")[0] ?? href;
  if (base === "/admin/orders") {
    return pathname === "/admin/orders" || pathname.startsWith("/admin/orders/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBlock({
  title,
  items,
  pathname,
  extra,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  extra?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className={`mb-1.5 ${groupTitleClass}`}>{title}</div>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${navLinkBase} ${matchActive(pathname, item.href) ? navLinkActive : navLinkIdle}`}
          >
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
        {extra}
      </div>
    </div>
  );
}

function AdminOrdersSubnav() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "demand";
  const [useAi, setUseAi] = useAiConsumptionToggle();

  const subHref = (t: string) => `/admin/orders?tab=${t}`;
  const active = (t: string) => tab === t;

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-black/[0.07] bg-black/[0.015] p-2">
      <div>
        <button
          type="button"
          className={[
            "h-9 w-full rounded-lg border px-2.5 text-[12px] font-black transition-colors active:scale-[0.99]",
            useAi
              ? "border-emerald-700/30 bg-emerald-600 text-white hover:bg-emerald-600/90"
              : "border-black/15 bg-white text-black hover:bg-black/[0.04]",
          ].join(" ")}
          onClick={() => setUseAi((v) => !v)}
          title="KI-Prognose an/aus"
        >
          {useAi ? "KI Prognose aktiv" : "Klassische Berechnung"}
        </button>
        <p className="mt-1 px-1 text-[10px] font-bold leading-snug text-black/45">
          Ohne KI-Daten: gleiche Logik wie „klassisch“.
        </p>
      </div>

      <div className="space-y-0.5">
        <div className={`pb-0.5 ${groupTitleClass}`}>1 · Rabenstein</div>
        <Link
          href={subHref("demand")}
          className={`${subLinkBase} ${active("demand") ? subLinkActive : subLinkIdle}`}
        >
          <span className="truncate">Bedarf</span>
        </Link>
        <Link
          href={subHref("central")}
          className={`${subLinkBase} ${active("central") ? subLinkActive : subLinkIdle}`}
        >
          <span className="truncate">Lager</span>
        </Link>
      </div>

      <div className="space-y-0.5">
        <Link
          href={subHref("hofstetten")}
          className={`${subLinkBase} ${active("hofstetten") ? subLinkActive : subLinkIdle}`}
        >
          <span className="truncate">2 · {HOFSTETTEN_NAME}</span>
        </Link>
        <Link
          href={subHref("kirchberg")}
          className={`${subLinkBase} ${active("kirchberg") ? subLinkActive : subLinkIdle}`}
        >
          <span className="truncate">3 · {KIRCHBERG_NAME}</span>
        </Link>
      </div>
    </div>
  );
}

export function AdminNavSuspenseFallback() {
  return (
    <aside
      className="sticky top-[72px] z-30 flex h-[calc(100vh-72px)] w-56 shrink-0 flex-col border-r border-black/10 bg-[var(--background)] sm:w-60"
      aria-hidden
    />
  );
}

export function AdminNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { exitAdmin } = useAdmin();
  const onOrders = pathname === "/admin/orders" || pathname.startsWith("/admin/orders/");

  return (
    <aside
      className="sticky top-[72px] z-30 flex h-[calc(100vh-72px)] w-56 shrink-0 flex-col border-r border-black/10 bg-[var(--background)] sm:w-60"
      aria-label="Admin-Navigation"
    >
      <div className="px-4 pt-4">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-black/35">
          Admin
        </div>
        <div className="mt-0.5 text-base font-black tracking-tight text-black">
          Bstand
        </div>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4 pt-4 sm:px-4">
        <NavBlock title="Monitoring" items={monitoring} pathname={pathname} />
        <NavBlock
          title="Aktionen"
          items={actions}
          pathname={pathname}
          extra={
            <>
              {onOrders ? <AdminOrdersSubnav /> : null}
              <span
                className="mt-1 inline-flex w-fit items-center gap-1 rounded-lg border border-dashed border-black/20 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-black/35"
                title="Geplant"
              >
                Transfers · bald
              </span>
            </>
          }
        />
        <NavBlock title="Debug · Historie" items={debug} pathname={pathname} />
        <div className="mt-auto border-t border-black/10 pt-3">
          <button
            type="button"
            className="h-10 w-full rounded-xl border border-black/15 bg-white px-3 text-[13px] font-black text-black hover:bg-black/[0.04] transition-colors active:scale-[0.99]"
            onClick={() => {
              exitAdmin();
              router.replace("/login");
            }}
          >
            Admin beenden
          </button>
        </div>
      </nav>
    </aside>
  );
}
