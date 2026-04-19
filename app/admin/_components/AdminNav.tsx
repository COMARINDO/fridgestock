"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";

const navLink =
  "inline-flex items-center rounded-xl px-2.5 py-1.5 text-xs font-black transition-colors sm:text-sm";
const navLinkIdle = "text-black/75 hover:bg-black/5 hover:text-black";
const navLinkActive = "bg-black text-white";

type NavItem = { href: string; label: string };

const monitoring: NavItem[] = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/inventory-sessions", label: "Inventur-Sessions" },
];

const actions: NavItem[] = [
  { href: "/admin/orders", label: "Bestellungen" },
];

const debug: NavItem[] = [
  { href: "/admin/bookings", label: "Buchungen" },
  { href: "/admin/submitted-orders", label: "Abgeschickte Bestellungen" },
];

function matchActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { exitAdmin } = useAdmin();

  return (
    <nav
      className="sticky top-[72px] z-30 border-b-2 border-black bg-[var(--background)]/95 backdrop-blur-sm text-left"
      aria-label="Admin-Navigation"
    >
      <div className="mx-auto max-w-5xl px-3 py-2 sm:px-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-black/45 sm:text-xs">
              Monitoring
            </span>
            <div className="flex flex-wrap gap-1">
              {monitoring.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${navLink} ${matchActive(pathname, item.href) ? navLinkActive : navLinkIdle}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/10 pt-2 sm:border-t-0 sm:pt-0">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-black/45 sm:text-xs">
              Aktionen
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {actions.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${navLink} ${matchActive(pathname, item.href) ? navLinkActive : navLinkIdle}`}
                >
                  {item.label}
                </Link>
              ))}
              <span
                className="hidden rounded-xl border border-dashed border-black/25 px-2 py-1 text-[10px] font-black text-black/40 sm:inline"
                title="Geplant"
              >
                Transfers
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/10 pt-2 sm:border-t-0 sm:pt-0">
            <span className="shrink-0 text-[10px] font-black uppercase tracking-wider text-black/45 sm:text-xs">
              Debug / Historie
            </span>
            <div className="flex flex-wrap gap-1">
              {debug.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${navLink} ${matchActive(pathname, item.href) ? navLinkActive : navLinkIdle}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="self-start border-t border-black/10 pt-2 sm:border-t-0 sm:pt-0">
            <button
              type="button"
              className="h-9 rounded-2xl border-2 border-black bg-white px-3 text-xs font-black text-black active:scale-[0.99] sm:h-10 sm:px-4 sm:text-sm"
              onClick={() => {
                exitAdmin();
                router.replace("/login");
              }}
            >
              Admin beenden
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
