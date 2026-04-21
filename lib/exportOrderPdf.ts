"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type OrderPdfRow = {
  name: string;
  metroNr?: string | null;
  unit?: string | null;
  units: number;
  piecesPerUnit?: number | null;
};

export type OrderPdfOptions = {
  title: string;
  subtitle?: string;
  rows: OrderPdfRow[];
  fileName?: string;
  /**
   * When true, renders a "Stück gesamt" column (units * piecesPerUnit).
   * Useful for warehouse orders where the operator wants to see both the
   * unit count (what Metro ships) and the resulting piece count.
   */
  includePieces?: boolean;
};

function isoWeekParts(date: Date): { year: number; week: number } {
  // ISO week calculation per RFC 3339 / ISO 8601.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function defaultOrderPdfFileName(prefix: string, now: Date = new Date()): string {
  const { year, week } = isoWeekParts(now);
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const safe = prefix.replace(/[^a-z0-9äöüß_-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${safe}-KW${week}-${year}-${yyyy}${mm}${dd}.pdf`;
}

export function downloadOrderPdf(opts: OrderPdfOptions): void {
  const rows = (opts.rows ?? []).filter((r) => r && r.units > 0);
  if (rows.length === 0) {
    throw new Error("Keine Positionen zum Exportieren.");
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, marginX, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const now = new Date();
  const { year, week } = isoWeekParts(now);
  const dateStr = now.toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  const meta = `KW ${week}/${year} · ${dateStr} ${timeStr}`;
  doc.text(meta, pageWidth - marginX, 18, { align: "right" });

  let cursorY = 24;
  if (opts.subtitle) {
    doc.setFontSize(11);
    doc.setTextColor(80);
    doc.text(opts.subtitle, marginX, cursorY);
    doc.setTextColor(0);
    cursorY += 4;
  }

  const head = opts.includePieces
    ? [["Produkt", "Metro Nr", "Einheit", "Menge", "Stück gesamt"]]
    : [["Produkt", "Metro Nr", "Einheit", "Menge"]];

  const body = rows.map((r) => {
    const units = Math.max(0, Math.floor(Number(r.units) || 0));
    const ppu = Math.max(1, Math.floor(Number(r.piecesPerUnit ?? 1) || 1));
    const base: (string | number)[] = [
      r.name ?? "",
      r.metroNr ?? "—",
      r.unit ?? "—",
      units,
    ];
    if (opts.includePieces) base.push(units * ppu);
    return base;
  });

  const totalUnits = rows.reduce(
    (acc, r) => acc + Math.max(0, Math.floor(Number(r.units) || 0)),
    0
  );
  const totalPieces = rows.reduce((acc, r) => {
    const units = Math.max(0, Math.floor(Number(r.units) || 0));
    const ppu = Math.max(1, Math.floor(Number(r.piecesPerUnit ?? 1) || 1));
    return acc + units * ppu;
  }, 0);

  const foot = opts.includePieces
    ? [["Summe", "", "", String(totalUnits), String(totalPieces)]]
    : [["Summe", "", "", String(totalUnits)]];

  autoTable(doc, {
    head,
    body,
    foot,
    startY: cursorY + 2,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 10, cellPadding: 2.5, overflow: "linebreak" },
    headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: "bold" },
    columnStyles: opts.includePieces
      ? {
          0: { cellWidth: "auto" },
          1: { cellWidth: 26 },
          2: { cellWidth: 22 },
          3: { cellWidth: 20, halign: "right" },
          4: { cellWidth: 28, halign: "right" },
        }
      : {
          0: { cellWidth: "auto" },
          1: { cellWidth: 30 },
          2: { cellWidth: 26 },
          3: { cellWidth: 24, halign: "right" },
        },
  });

  const fileName = opts.fileName ?? defaultOrderPdfFileName("Bestellung");
  doc.save(fileName);
}
