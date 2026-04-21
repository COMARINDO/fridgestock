/**
 * Designsystem-Klassen für den Admin-Bereich.
 * Ziel: ruhig, klar, mobil-freundlich. Wenig Rauschen, hohe Lesbarkeit,
 * konsistente Spacing/Radien/Schatten.
 */

/* Layout / Sections ---------------------------------------------------- */

/** Schmale, ruhige Karte (Standard) */
export const adminCardClass =
  "rounded-2xl border border-black/10 bg-white p-4 sm:p-5 shadow-[0_1px_0_0_rgba(0,0,0,0.04)]";

/** Karte für „lesen“ – gleiches Aussehen wie Card, einfach lesbarer Content */
export const adminReadSectionClass = adminCardClass;

/** Karte für „Aktionen“ – dezenter amber-Akzent links */
export const adminActionSectionClass =
  "rounded-2xl border border-black/10 bg-white p-4 sm:p-5 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] " +
  "border-l-[3px] border-l-amber-500/70";

/** Sub-Überschrift einer Karte */
export const adminSectionTitleClass =
  "text-[11px] font-black uppercase tracking-[0.08em] text-black/55";

/** Hauptüberschrift in einer Karte */
export const adminCardHeadlineClass =
  "text-base sm:text-lg font-black tracking-tight text-black";

/** Kleinerer Helper-Text */
export const adminMutedTextClass = "text-sm font-bold text-black/55";

/* Buttons -------------------------------------------------------------- */

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-black " +
  "transition-colors active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

export const adminPrimaryButtonClass =
  `${buttonBase} h-10 bg-black text-white hover:bg-black/85`;

export const adminSecondaryButtonClass =
  `${buttonBase} h-10 border border-black/15 bg-white text-black hover:bg-black/[0.04]`;

export const adminGhostButtonClass =
  `${buttonBase} h-10 bg-transparent text-black/70 hover:text-black hover:bg-black/[0.04]`;

export const adminPrimaryButtonLgClass =
  `${buttonBase} h-12 bg-black text-white hover:bg-black/85 px-4`;

export const adminSecondaryButtonLgClass =
  `${buttonBase} h-12 border border-black/15 bg-white text-black hover:bg-black/[0.04] px-4`;

export const adminDangerButtonClass =
  `${buttonBase} h-10 border border-red-800/30 bg-red-50 text-red-900 hover:bg-red-100`;

export const adminDangerButtonLgClass =
  `${buttonBase} h-12 border border-red-800/30 bg-red-50 text-red-900 hover:bg-red-100 px-4`;

export const adminDangerButtonSmClass =
  `${buttonBase} h-9 border border-red-800/30 bg-red-50 text-red-900 hover:bg-red-100 text-xs`;

/**
 * Sekundär-Button im neobrutalen Stil (2-px schwarzer Rand, harter Schatten,
 * uppercase). Wird in Bestell-Ansichten für Aktionen genutzt, die visuell
 * neben dem primären schwarzen CTA stehen sollen (z.B. "PDF Export").
 */
export const adminBrutalSecondaryButtonLgClass =
  "rounded-xl border-2 border-black bg-white px-4 py-2 text-sm font-black uppercase tracking-wide text-black " +
  "shadow-[3px_3px_0_rgba(0,0,0,1)] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/* Form-Elemente -------------------------------------------------------- */

export const adminInputClass =
  "h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-[15px] font-bold text-black " +
  "outline-none focus-visible:ring-2 focus-visible:ring-black/20";

export const adminSelectClass = adminInputClass + " pr-8";

/* Banner / Status ------------------------------------------------------ */

const bannerBase = "rounded-2xl border p-3 sm:p-4 text-sm font-bold leading-snug";

export const adminBannerInfoClass =
  `${bannerBase} border-black/10 bg-zinc-50 text-black/80`;

export const adminBannerSuccessClass =
  `${bannerBase} border-emerald-700/20 bg-emerald-50 text-emerald-950`;

export const adminBannerWarnClass =
  `${bannerBase} border-amber-700/25 bg-amber-50 text-amber-950`;

export const adminBannerErrorClass =
  `${bannerBase} border-red-700/25 bg-red-50 text-red-900`;

/* Badges --------------------------------------------------------------- */

const badgeBase =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-wide";

export const adminBadgeNeutralClass =
  `${badgeBase} border-black/15 bg-white text-black/70`;

export const adminBadgeSuccessClass =
  `${badgeBase} border-emerald-700/30 bg-emerald-50 text-emerald-900`;

export const adminBadgeWarnClass =
  `${badgeBase} border-amber-700/30 bg-amber-50 text-amber-900`;

export const adminBadgeDangerClass =
  `${badgeBase} border-red-700/30 bg-red-50 text-red-900`;

/* Tabellen ------------------------------------------------------------- */

/**
 * Container um eine Tabelle: weiße Karte mit feinem Rahmen.
 * Wichtig: KEIN `overflow-hidden`/`overflow-auto` auf desktop, sonst bricht
 * `position: sticky` für den Tabellenkopf. Auf mobile darf horizontal
 * gescrollt werden (`overflow-x-auto`), das beeinträchtigt vertikales
 * Sticky nicht.
 */
export const adminTableShellClass =
  "rounded-2xl border border-black/10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.04)] " +
  "max-md:overflow-x-auto md:overflow-clip";

/** Tabelle selber */
export const adminTableClass = "w-full text-left text-sm";

/** Sticky-Kopfzelle unter der TopBar (72px). */
export const adminTableStickyHeadCellClass =
  "sticky top-[72px] z-30 bg-zinc-50 " +
  "px-3 py-2.5 text-left text-[12px] font-black text-black/65 whitespace-nowrap " +
  "border-b border-black/10";

/** Reguläre (nicht sticky) Kopfzelle */
export const adminTableHeadCellClass =
  "px-3 py-2.5 text-left text-[12px] font-black text-black/65 whitespace-nowrap " +
  "bg-zinc-50 border-b border-black/10";

/** Body-Zeile */
export const adminTableRowClass =
  "border-b border-black/[0.06] hover:bg-black/[0.015] transition-colors";

/** Body-Zelle Standard */
export const adminTableCellClass = "p-3 align-middle";

/* Tabs ---------------------------------------------------------------- */

export const adminTabBaseClass =
  "h-10 inline-flex items-center justify-center rounded-xl px-3 text-sm font-black " +
  "transition-colors active:scale-[0.99]";

export const adminTabIdleClass = "text-black/65 hover:bg-black/[0.04]";

export const adminTabActiveClass = "bg-black text-white";

/* Order-Ansicht spezifisch ------------------------------------------- */

/**
 * Dünne Erklär-/Formel-Zeile unter Produkten in Bestell-Tabellen.
 * Etwas größer als vorher (text-[11px]) und mit break-words, damit längere
 * deutsche Strings auch auf Mobile noch lesbar bleiben statt zu überlaufen.
 */
export const adminOrderFormulaClass =
  "mt-1 max-w-full break-words text-[11px] leading-snug font-bold text-black/55 tabular-nums";

/**
 * Einheitlicher Empty-State in oder unter Tabellen.
 * Ersetzt die bisher gemischten <p>-/<tr>-Varianten.
 */
export const adminEmptyStateClass =
  "px-4 py-6 text-center text-sm font-black text-black/55 border-t border-black/[0.06]";

/**
 * Horizontaler Scroll-Hinweis auf mobilen Breakpoints. Fügt rechts einen
 * dezenten Schatten hinzu, damit klar ist, dass die Tabelle horizontal
 * gescrollt werden kann. Komplementiert `adminTableShellClass`.
 */
export const adminTableScrollHintClass =
  "relative before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:w-6 " +
  "before:bg-gradient-to-l before:from-black/[0.06] before:to-transparent md:before:hidden";
