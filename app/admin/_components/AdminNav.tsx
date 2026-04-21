"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAdmin } from "@/app/admin-provider";
import { HOFSTETTEN_NAME, KIRCHBERG_NAME } from "@/lib/locationConstants";
import { useAdminNavExtrasToggle } from "@/lib/useAdminNavExtrasToggle";
import { useAiConsumptionToggle } from "@/lib/useAiConsumptionToggle";
import { useArticleTrackingToggle } from "@/lib/useArticleTrackingToggle";
import { useOrderFormulaToggle } from "@/lib/useOrderFormulaToggle";
import { useOrderReserveEnabled } from "@/lib/useOrderReserveEnabled";
import { useOrderReservePct } from "@/lib/useOrderReservePct";
import { ORDER_RESERVE_PCT_MAX } from "@/lib/orderSuggestions";

const navLinkBase =
  "group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-black " +
  "transition-colors";
const navLinkIdle = "text-black/70 hover:bg-black/[0.04] hover:text-black";
const navLinkActive = "bg-black text-white shadow-[0_1px_0_0_rgba(0,0,0,0.1)]";

const subLinkBase =
  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-black " +
  "transition-colors";
const subLinkIdle = "text-black/65 hover:bg-black/[0.04] hover:text-black";
// Aktiver Sub-Link bekommt denselben schwarzen Pill-Look wie die Top-Level-Aktion,
// damit auf einen Blick klar ist, wo man sich befindet.
const subLinkActive = "bg-black text-white";

const groupTitleClass =
  "px-2 text-[10px] font-black uppercase tracking-[0.12em] text-black/40";

type NavItem = { href: string; label: string };

const monitoring: NavItem[] = [
  { href: "/admin", label: "Übersicht" },
  { href: "/admin/inventory-sessions", label: "Inventur-Sessions" },
  { href: "/admin/shrinkage", label: "Schwund · Lager" },
];

const articleTrackingItem: NavItem = {
  href: "/admin/article-tracking",
  label: "Artikel-Tracking",
};

const actions: NavItem[] = [
  { href: "/admin/orders?tab=demand", label: "Bestellungen" },
  { href: "/admin/customer-orders", label: "Kundenbestellungen" },
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
        {items.map((item) => {
          const isActive = matchActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`${navLinkBase} ${isActive ? navLinkActive : navLinkIdle}`}
            >
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        {extra}
      </div>
    </div>
  );
}

function AdminOrdersSubnav() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "demand";

  const subHref = (t: string) => `/admin/orders?tab=${t}`;
  const active = (t: string) => tab === t;

  function subLink(tabId: string, label: ReactNode) {
    const isActive = active(tabId);
    return (
      <Link
        href={subHref(tabId)}
        aria-current={isActive ? "page" : undefined}
        className={`${subLinkBase} ${isActive ? subLinkActive : subLinkIdle}`}
      >
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-black/[0.07] bg-black/[0.02] p-2">
      <div className="space-y-0.5">
        <div className={`pb-0.5 ${groupTitleClass}`}>1 · Rabenstein</div>
        {subLink("demand", "Bedarf")}
        {subLink("central", "Lager")}
      </div>

      <div className="space-y-0.5">
        {subLink("hofstetten", `2 · ${HOFSTETTEN_NAME}`)}
        {subLink("kirchberg", `3 · ${KIRCHBERG_NAME}`)}
      </div>

      <div className="space-y-0.5">{subLink("delivery", "4 · Lieferungen")}</div>
    </div>
  );
}

function PillSwitch({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      title={title}
      className={[
        "flex h-9 w-full items-center justify-between gap-2 rounded-xl border px-3 text-[12px] font-black transition-colors active:scale-[0.99]",
        checked
          ? "border-black/15 bg-black/[0.04] text-black"
          : "border-black/10 bg-white text-black/65 hover:text-black hover:bg-black/[0.03]",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span
        className={[
          "inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "border-emerald-700/30 bg-emerald-600"
            : "border-black/15 bg-black/10",
        ].join(" ")}
        aria-hidden
      >
        <span
          className={[
            "ml-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          ].join(" ")}
        />
      </span>
    </button>
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
  const [showExtras, setShowExtras] = useAdminNavExtrasToggle();
  const [useAi, setUseAi] = useAiConsumptionToggle();
  const [articleTracking, setArticleTracking] = useArticleTrackingToggle();
  const [showFormula, setShowFormula] = useOrderFormulaToggle();
  const [reserveEnabled, setReserveEnabled] = useOrderReserveEnabled();
  const [reservePct, setReservePct] = useOrderReservePct();

  return (
    <aside
      className="sticky top-[72px] z-30 flex h-[calc(100vh-72px)] w-56 shrink-0 flex-col border-r border-black/10 bg-[var(--background)] sm:w-60"
      aria-label="Admin-Navigation"
    >
      <Link
        href="/admin"
        className="mx-3 mt-3 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-black/[0.04] sm:mx-4"
        title="Admin · Übersicht"
      >
        <Image
          src="/logo.png"
          alt="Ordarella"
          width={80}
          height={80}
          priority
          className="h-10 w-10 shrink-0 rounded-lg object-contain shadow-[0_4px_10px_-6px_rgba(236,72,153,0.5)]"
        />
        <div className="min-w-0 leading-tight">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-black/35">
            Admin
          </div>
          <div className="text-[12px] font-black text-black/55">
            Bestellsystem
          </div>
        </div>
      </Link>
      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4 pt-4 sm:px-4">
        {showExtras ? (
          <NavBlock
            title="Monitoring"
            items={
              articleTracking ? [...monitoring, articleTrackingItem] : monitoring
            }
            pathname={pathname}
          />
        ) : null}
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
        {showExtras ? (
          <NavBlock title="Debug · Historie" items={debug} pathname={pathname} />
        ) : null}
        <div className="mt-auto flex flex-col gap-2 border-t border-black/10 pt-3">
          <PillSwitch
            label="KI-Prognose"
            checked={useAi}
            onChange={() => setUseAi((v) => !v)}
            title="KI-Prognose an/aus"
          />
          <PillSwitch
            label="Formel"
            checked={showFormula}
            onChange={() => setShowFormula(!showFormula)}
            title="Formel-Zeile unter Produkten ein-/ausblenden"
          />
          <PillSwitch
            label="Reserve"
            checked={reserveEnabled}
            onChange={() => {
              const next = !reserveEnabled;
              setReserveEnabled(next);
              if (next && reservePct <= 0) {
                setReservePct(10);
              }
            }}
            title="Reserve-Aufschlag auf Bestellvorschläge an/aus"
          />
          {reserveEnabled ? (
            <label
              className="-mt-1 flex h-9 items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 text-[12px] font-black text-emerald-800"
              title={`Prozentsatz, der zum Stück-Bedarf addiert wird (0–${ORDER_RESERVE_PCT_MAX} %).`}
            >
              <span className="select-none">+</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={ORDER_RESERVE_PCT_MAX}
                step={1}
                value={reservePct}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setReservePct(Number.isFinite(n) ? n : 0);
                }}
                onFocus={(e) => e.currentTarget.select()}
                className="h-6 w-14 rounded-md border border-emerald-600/40 bg-white px-1.5 text-right text-[12px] font-black text-black tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                aria-label="Reserve in Prozent"
              />
              <span className="select-none">% auf Stück-Bedarf</span>
            </label>
          ) : null}
          <PillSwitch
            label="Artikel-Tracking"
            checked={articleTracking}
            onChange={() => {
              setArticleTracking((v) => !v);
              if (!showExtras) setShowExtras(true);
            }}
            title="Artikel-Tracking (Bewegungshistorie pro Artikel) ein-/ausblenden. Öffnet das Monitoring-Menü automatisch."
          />
          <PillSwitch
            label="Monitoring & Debug"
            checked={showExtras}
            onChange={() => setShowExtras((v) => !v)}
            title="Monitoring & Debug ein-/ausblenden"
          />
          <div className="mt-2 flex flex-col gap-1.5 border-t border-black/10 pt-3">
            <a
              href="/Ordarella-Anleitung.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-black/15 bg-white px-3 text-[12px] font-black text-black/75 hover:bg-black/[0.04] hover:text-black transition-colors active:scale-[0.99]"
              title="Kurzanleitung als PDF öffnen"
            >
              <span aria-hidden>📘</span>
              <span>Anleitung (PDF)</span>
            </a>
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
        </div>
      </nav>
    </aside>
  );
}
