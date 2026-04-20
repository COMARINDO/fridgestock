/**
 * Heuristisches Parsen einer Freitext-"Abholzeit" zu einem Datum (YYYY-MM-DD).
 *
 * Erkennt:
 *  - "heute", "today"
 *  - "morgen", "tomorrow"
 *  - "uebermorgen", "übermorgen", "ubermorgen"
 *  - Wochentage: "montag" .. "sonntag" (auch en: "monday" .. "sunday")
 *  - Datumsformate: 19.4., 19.4.2026, 19/4, 2026-04-19
 *  - Ohne erkennbares Datum -> null (Caller bucket "Unbestimmt")
 *
 * Liefert immer ein YYYY-MM-DD String (lokale Zeitzone) ohne Uhrzeit.
 *
 * Bewusst pragmatisch und tolerant: lieber gut genug raten als gar nichts
 * zeigen. Edge-Cases werden in den "Unbestimmt"-Bucket gespiegelt.
 */

const WEEKDAYS_DE: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
};

const WEEKDAYS_EN: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ABBREV_DE: Record<string, number> = {
  so: 0,
  mo: 1,
  di: 2,
  mi: 3,
  do: 4,
  fr: 5,
  sa: 6,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, delta: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + delta);
  return c;
}

function nextWeekday(from: Date, target: number): Date {
  const cur = from.getDay();
  let delta = target - cur;
  if (delta <= 0) delta += 7;
  return addDays(from, delta);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export type ParsedPickup = {
  /** YYYY-MM-DD oder null (unbestimmt). */
  isoDate: string | null;
  /** Lesbares Label fuer die Gruppen-Ueberschrift. */
  label: string;
};

export function parsePickupDay(
  text: string,
  now: Date = new Date()
): ParsedPickup {
  const raw = (text ?? "").trim();
  if (!raw) return { isoDate: null, label: "Ohne Angabe" };

  const today = startOfDay(now);
  const norm = normalize(raw);

  if (/\b(heute|today)\b/.test(norm)) {
    return { isoDate: toLocalIsoDate(today), label: labelFor(today) };
  }
  if (/\b(uebermorgen|ubermorgen|day after tomorrow)\b/.test(norm)) {
    const d = addDays(today, 2);
    return { isoDate: toLocalIsoDate(d), label: labelFor(d) };
  }
  if (/\b(morgen|tomorrow)\b/.test(norm)) {
    const d = addDays(today, 1);
    return { isoDate: toLocalIsoDate(d), label: labelFor(d) };
  }

  // ISO Datum YYYY-MM-DD
  const iso = norm.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const date = new Date(y, m - 1, d);
    if (!Number.isNaN(date.getTime())) {
      return { isoDate: toLocalIsoDate(date), label: labelFor(date) };
    }
  }

  // DD.MM[.YYYY] oder DD/MM[/YYYY]
  const dm = norm.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    let y = dm[3] ? Number(dm[3]) : today.getFullYear();
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let date = new Date(y, m - 1, d);
      if (!dm[3] && date < today) {
        // Datum ohne Jahr, das in der Vergangenheit liegt -> naechstes Jahr
        date = new Date(y + 1, m - 1, d);
      }
      if (!Number.isNaN(date.getTime())) {
        return { isoDate: toLocalIsoDate(date), label: labelFor(date) };
      }
    }
  }

  // Wochentag: voll oder Abkuerzung
  for (const [name, idx] of Object.entries(WEEKDAYS_DE)) {
    if (new RegExp(`\\b${name}\\b`).test(norm)) {
      const d = nextWeekday(today, idx);
      return { isoDate: toLocalIsoDate(d), label: labelFor(d) };
    }
  }
  for (const [name, idx] of Object.entries(WEEKDAYS_EN)) {
    if (new RegExp(`\\b${name}\\b`).test(norm)) {
      const d = nextWeekday(today, idx);
      return { isoDate: toLocalIsoDate(d), label: labelFor(d) };
    }
  }
  for (const [abbr, idx] of Object.entries(ABBREV_DE)) {
    if (new RegExp(`\\b${abbr}\\b`).test(norm)) {
      const d = nextWeekday(today, idx);
      return { isoDate: toLocalIsoDate(d), label: labelFor(d) };
    }
  }

  return { isoDate: null, label: "Ohne genauen Tag" };
}

const WEEKDAY_LABEL = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function labelFor(d: Date, now: Date = new Date()): string {
  const today = startOfDay(now);
  const target = startOfDay(d);
  const deltaDays = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  );
  const datePart = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
  if (deltaDays === 0) return `Heute · ${datePart}`;
  if (deltaDays === 1) return `Morgen · ${datePart}`;
  if (deltaDays === -1) return `Gestern · ${datePart}`;
  if (deltaDays > 1 && deltaDays <= 7) {
    return `${WEEKDAY_LABEL[d.getDay()]} · ${datePart}`;
  }
  return `${WEEKDAY_LABEL[d.getDay()]}, ${datePart}`;
}
