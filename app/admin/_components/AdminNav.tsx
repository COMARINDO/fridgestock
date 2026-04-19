"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { HOFSTETTEN_NAME, KIRCHBERG_NAME } from "@/lib/locationConstants";
import { useAiConsumptionToggle } from "@/lib/useAiConsumptionToggle";

const navLink =
  "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-black transition-colors sm:text-[15px]";
const navLinkIdle = "text-black/80 hover:bg-black/5 hover:text-black";
const navLinkActive = "bg-black text-white";

const subLinkBase =
  "flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs font-black transition-colors";
const subLinkIdle = "text-black/75 hover:bg-black/5 hover:text-black";
const subLinkActive = "bg-black text-white";

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
      <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-black/45">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${navLink} ${matchActive(pathname, item.href) ? navLinkActive : navLinkIdle}`}
          >
            {item.label}
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
    <div
      className="mt-2 space-y-3 border-l-2 border-black/15 pl-3"
      aria-label="Bestellungen Unterbereiche"
    >
      <div>
        <button
          type="button"
          className={[
            "h-9 w-full max-w-[13rem] rounded-xl border-2 px-2 text-xs font-black transition-colors active:scale-[0.99]",
            useAi ? "border-emerald-800 bg-emerald-700 text-white" : "border-black bg-white text-black",
          ].join(" ")}
          onClick={() => setUseAi((v) => !v)}
          title="KI-Prognose an/aus"
        >
          {useAi ? "KI Prognose aktiv" : "Klassische Berechnung"}
        </button>
        <p className="mt-1.5 text-[10px] font-black leading-snug text-black/45">
          Ohne KI-Daten: gleiche Logik wie „klassisch“.
        </p>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-black uppercase tracking-wider text-black/40">
          1 · Rabenstein
        </div>
        <Link
          href={subHref("demand")}
          className={`${subLinkBase} pl-2 ${active("demand") ? subLinkActive : subLinkIdle}`}
        >
          Bedarf
        </Link>
        <Link
          href={subHref("central")}
          className={`${subLinkBase} pl-2 ${active("central") ? subLinkActive : subLinkIdle}`}
        >
          Lager
        </Link>
      </div>

      <Link
        href={subHref("hofstetten")}
        className={`${subLinkBase} ${active("hofstetten") ? subLinkActive : subLinkIdle}`}
      >
        2 · {HOFSTETTEN_NAME}
      </Link>

      <Link
        href={subHref("kirchberg")}
        className={`${subLinkBase} ${active("kirchberg") ? subLinkActive : subLinkIdle}`}
      >
        3 · {KIRCHBERG_NAME}
      </Link>
    </div>
  );
}

export function AdminNavSuspenseFallback() {
  return (
    <aside
      className="sticky top-[72px] z-30 flex h-[calc(100vh-72px)] w-56 shrink-0 flex-col border-r-2 border-black bg-[var(--background)] sm:w-60"
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
      className="sticky top-[72px] z-30 flex h-[calc(100vh-72px)] w-56 shrink-0 flex-col border-r-2 border-black bg-[var(--background)] sm:w-60"
      aria-label="Admin-Navigation"
    >
      <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-3 sm:p-4">
        <NavBlock title="Monitoring" items={monitoring} pathname={pathname} />
        <NavBlock
          title="Aktionen"
          items={actions}
          pathname={pathname}
          extra={
            <>
              {onOrders ? <AdminOrdersSubnav /> : null}
              <span
                className="mt-1 inline-flex rounded-xl border border-dashed border-black/25 px-2 py-1.5 text-[10px] font-black text-black/40"
                title="Geplant"
              >
                Transfers
              </span>
            </>
          }
        />
        <NavBlock title="Debug / Historie" items={debug} pathname={pathname} />
        <div className="mt-auto border-t border-black/10 pt-4">
          <button
            type="button"
            className="h-10 w-full rounded-2xl border-2 border-black bg-white px-3 text-sm font-black text-black active:scale-[0.99]"
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
