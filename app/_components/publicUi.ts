/**
 * Designsystem-Klassen für die öffentlichen Oberflächen
 * (Login, Order/Chatbot, Location). Wärmerer Ton als der Admin,
 * aber konsistent: schwarze 2-px-Linie + fetter Schatten, runde Ecken,
 * klare Hierarchie.
 */

/* Cards ---------------------------------------------------------------- */

export const publicCardClass =
  "rounded-3xl border-2 border-black bg-white p-5 shadow-sm";

/* Buttons / CTAs ------------------------------------------------------- */

/** Primär-CTA (warm-peach) — für "Bestellung aufgeben" o.ä. */
export const publicCtaPrimaryClass =
  "block w-full rounded-3xl border-2 border-black bg-[#f2d2b6] px-5 py-5 text-center " +
  "text-[18px] font-extrabold text-black shadow-sm " +
  "hover:bg-[#eec79e] active:scale-[0.99]";

/** Sekundär-CTA (weiss, schlichter) — für "Anleitung (PDF)" o.ä. */
export const publicCtaSecondaryClass =
  "block w-full rounded-3xl border-2 border-black bg-white px-5 py-4 text-center " +
  "text-[16px] font-extrabold text-black shadow-sm " +
  "hover:bg-black/[0.04] active:scale-[0.99]";

/* Banner --------------------------------------------------------------- */

const publicBannerBase =
  "rounded-2xl border-2 border-black px-4 py-3 text-[15px] font-bold";

export const publicBannerInfoClass =
  `${publicBannerBase} bg-white text-black`;

export const publicBannerWarnClass =
  `${publicBannerBase} bg-amber-50 text-amber-950`;

export const publicBannerErrorClass =
  `${publicBannerBase} bg-red-50 text-red-900`;

/* Bottom-Sheet-Komponenten -------------------------------------------- */

/**
 * Close-Button für Bottom-Sheets in /location/[id] und /order.
 * Gleiche Optik an allen Stellen, damit der Nutzer den Hebel sofort erkennt.
 */
export const publicSheetCloseButtonClass =
  "inline-flex h-10 items-center justify-center rounded-2xl border-2 border-black bg-white " +
  "px-4 text-sm font-black text-black shadow-sm hover:bg-black/[0.04] active:scale-[0.99]";
