#!/usr/bin/env node
// Generates a simple, visual PDF guide that explains how Ordarella works.
// Output: public/Ordarella-Anleitung.pdf
//
// Run with: node scripts/generate-guide.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { jsPDF } from "jspdf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "Ordarella-Anleitung.pdf");

// ----- palette ----------------------------------------------------------
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const GREEN = [94, 184, 119];
const ORANGE = [255, 169, 77];
const BLUE = [90, 158, 222];
const GRAY = [230, 230, 230];
const DARK = [50, 50, 50];
const YELLOW = [255, 224, 102];

function setFill(doc, c) { doc.setFillColor(c[0], c[1], c[2]); }
function setText(doc, c) { doc.setTextColor(c[0], c[1], c[2]); }
function setDraw(doc, c) { doc.setDrawColor(c[0], c[1], c[2]); }

// Neobrutalist card with drop shadow
function card(doc, x, y, w, h, color, shadow = true) {
  if (shadow) {
    setFill(doc, BLACK);
    doc.rect(x + 1.5, y + 1.5, w, h, "F");
  }
  setFill(doc, color);
  setDraw(doc, BLACK);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h, "FD");
}

function centeredText(doc, text, x, y, w, opts = {}) {
  doc.text(text, x + w / 2, y, { align: "center", ...opts });
}

function arrow(doc, x1, y1, x2, y2) {
  setDraw(doc, BLACK);
  doc.setLineWidth(0.8);
  doc.line(x1, y1, x2, y2);
  // arrow head
  const len = 2.5;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const hx1 = x2 - len * Math.cos(angle - Math.PI / 6);
  const hy1 = y2 - len * Math.sin(angle - Math.PI / 6);
  const hx2 = x2 - len * Math.cos(angle + Math.PI / 6);
  const hy2 = y2 - len * Math.sin(angle + Math.PI / 6);
  doc.line(x2, y2, hx1, hy1);
  doc.line(x2, y2, hx2, hy2);
}

function pageTitle(doc, title, subtitle) {
  setText(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(title, 14, 20);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    setText(doc, DARK);
    doc.text(subtitle, 14, 27);
  }
  setDraw(doc, BLACK);
  doc.setLineWidth(0.5);
  doc.line(14, 31, 196, 31);
}

function footer(doc, pageNo, pageTotal) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(doc, DARK);
  doc.text(`Ordarella · Kurzanleitung`, 14, 287);
  doc.text(`${pageNo} / ${pageTotal}`, 196, 287, { align: "right" });
}

// ---------- DOC ---------------------------------------------------------
const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
const TOTAL_PAGES = 5;

// ============================================================
// PAGE 1 — Cover / große Übersicht
// ============================================================
setFill(doc, YELLOW);
doc.rect(0, 0, 210, 297, "F");

// Big title
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(42);
doc.text("Ordarella", 105, 60, { align: "center" });

doc.setFontSize(14);
doc.setFont("helvetica", "normal");
doc.text("So funktioniert das Programm", 105, 72, { align: "center" });

// Core loop diagram
const cx = 105;
const cy = 160;
const boxW = 55;
const boxH = 22;

// 4 boxes arranged as a cycle: top, right, bottom, left
const top = { x: cx - boxW / 2, y: cy - 55 };
const right = { x: cx + 30, y: cy - 11 };
const bottom = { x: cx - boxW / 2, y: cy + 33 };
const left = { x: cx - 30 - boxW, y: cy - 11 };

function labeledCard(pos, color, title, line1, line2) {
  card(doc, pos.x, pos.y, boxW, boxH, color);
  setText(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  centeredText(doc, title, pos.x, pos.y + 8, boxW);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (line1) centeredText(doc, line1, pos.x, pos.y + 14, boxW);
  if (line2) centeredText(doc, line2, pos.x, pos.y + 18.5, boxW);
}

labeledCard(top, GREEN, "1. Inventur", "zählen was da ist", "pro Standort");
labeledCard(right, ORANGE, "2. Bedarf", "Filialen melden", "was fehlt");
labeledCard(bottom, BLUE, "3. Bestellung", "Admin archiviert", "+ PDF für Metro");
labeledCard(left, WHITE, "4. Lieferung", "einbuchen →", "Bestand wächst");

// Arrows (clockwise)
arrow(doc, top.x + boxW, top.y + boxH / 2 + 3, right.x, right.y + 3);
arrow(doc, right.x + boxW / 2, right.y + boxH, bottom.x + boxW, bottom.y + boxH / 2 - 3);
arrow(doc, bottom.x, bottom.y + boxH / 2, left.x + boxW, left.y + boxH - 3);
arrow(doc, left.x + boxW / 2, left.y, top.x, top.y + boxH / 2 - 3);

// Center label
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
setText(doc, BLACK);
doc.text("täglicher", cx, cy - 2, { align: "center" });
doc.text("Kreislauf", cx, cy + 4, { align: "center" });

// Footer hint
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
setText(doc, DARK);
doc.text(
  "Alles dreht sich um diesen Kreis. Wenn alle 4 Schritte sauber gemacht werden,",
  105,
  250,
  { align: "center" }
);
doc.text("passt der Bestand automatisch und die Bestellungen werden exakt.", 105, 256, {
  align: "center",
});

footer(doc, 1, TOTAL_PAGES);

// ============================================================
// PAGE 2 — Die Standorte
// ============================================================
doc.addPage();
pageTitle(doc, "Die Standorte", "Wer bekommt was — und wer liefert wohin?");

// METRO box
card(doc, 14, 45, 50, 20, GRAY);
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(13);
centeredText(doc, "METRO", 14, 54, 50);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(doc, "Großhändler", 14, 60, 50);

// Arrow to Lager
arrow(doc, 64, 55, 90, 55);
doc.setFontSize(8);
doc.text("liefert", 77, 53, { align: "center" });

// Lager
card(doc, 90, 45, 55, 20, GREEN);
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(13);
centeredText(doc, "Lager", 90, 54, 55);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(doc, "Rabenstein", 90, 60, 55);

// Fan out: 5 Verkaufstellen
const outlets = [
  { name: "Teich", color: ORANGE, deliv: "vom Lager" },
  { name: "Rabenstein Geschäft", color: ORANGE, deliv: "vom Lager" },
  { name: "Hofstetten", color: BLUE, deliv: "direkt Metro" },
  { name: "Kirchberg", color: BLUE, deliv: "direkt Metro" },
  { name: "Backstube", color: WHITE, deliv: "Sonderrolle" },
];
const startY = 95;
outlets.forEach((o, i) => {
  const y = startY + i * 22;
  card(doc, 60, y, 70, 16, o.color);
  setText(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  centeredText(doc, o.name, 60, y + 7, 70);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  centeredText(doc, o.deliv, 60, y + 12, 70);
  // arrow from Lager/Metro
  if (o.deliv === "vom Lager") {
    arrow(doc, 117, 65, 95, y);
  } else if (o.deliv === "direkt Metro") {
    arrow(doc, 35, 65, 60, y + 4);
  }
});

// Legende
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
setText(doc, BLACK);
doc.text("Legende", 145, 100);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
setFill(doc, GREEN);
doc.rect(145, 105, 6, 6, "F");
doc.text("Lager", 154, 110);
setFill(doc, ORANGE);
doc.rect(145, 114, 6, 6, "F");
doc.text("wird vom", 154, 119);
doc.text("Lager beliefert", 154, 123);
setFill(doc, BLUE);
doc.rect(145, 128, 6, 6, "F");
doc.text("eigene Metro-", 154, 133);
doc.text("Bestellung", 154, 137);
setFill(doc, WHITE);
setDraw(doc, BLACK);
doc.rect(145, 142, 6, 6, "FD");
doc.text("Sonderrolle", 154, 147);

footer(doc, 2, TOTAL_PAGES);

// ============================================================
// PAGE 3 — Der tägliche Ablauf
// ============================================================
doc.addPage();
pageTitle(doc, "Der tägliche Ablauf", "3 Momente am Tag — mehr brauchst du nicht");

const steps = [
  {
    time: "Morgens",
    title: "Inventur zählen",
    bullets: [
      "In jeder Filiale einloggen",
      "Jedes Produkt zählen, Menge eintragen",
      "Fertig → Filiale hat aktuellen Bestand",
    ],
    color: GREEN,
  },
  {
    time: "Tagsüber",
    title: "Bedarf melden (optional)",
    bullets: [
      "Wenn einer Filiale was ausgeht: auf „Bedarf melden“",
      "Produkt & Menge wählen",
      "Landet automatisch im Admin-Tab „Bedarf“",
    ],
    color: ORANGE,
  },
  {
    time: "Abends",
    title: "Bestellung aufgeben",
    bullets: [
      "Admin öffnet /admin/orders",
      "Tab „1 · Rabenstein“: Vorschlag prüfen, Mengen anpassen",
      "„PDF Export“ → PDF an Metro mailen",
      "„Bestellung archivieren“ → verschiebt Meldungen in „Lieferungen“",
    ],
    color: BLUE,
  },
  {
    time: "Wenn Lieferung kommt",
    title: "Lieferung einbuchen",
    bullets: [
      "Tab „4 · Lieferungen“ öffnen",
      "Mengen ggf. an echte Lieferung anpassen",
      "„Buchen“ → Bestand im Lager wächst automatisch",
    ],
    color: YELLOW,
  },
];

let sy = 42;
steps.forEach((s, idx) => {
  card(doc, 14, sy, 182, 36, s.color);
  // Badge (time)
  setFill(doc, BLACK);
  doc.rect(14, sy, 38, 36, "F");
  setText(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  centeredText(doc, s.time, 14, sy + 12, 38);
  doc.setFontSize(16);
  centeredText(doc, String(idx + 1), 14, sy + 25, 38);

  // Title + bullets
  setText(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(s.title, 56, sy + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  s.bullets.forEach((b, i) => {
    doc.text("•", 56, sy + 16 + i * 5);
    doc.text(b, 60, sy + 16 + i * 5);
  });

  sy += 40;
});

footer(doc, 3, TOTAL_PAGES);

// ============================================================
// PAGE 4 — Wie wird der Bedarf berechnet
// ============================================================
doc.addPage();
pageTitle(doc, "Wie wird der Bedarf berechnet?", "Einfache Logik, klare Formel");

// Flow: 3 boxes horizontally
const fy = 50;
const fbW = 52;
const fbH = 30;
card(doc, 14, fy, fbW, fbH, GREEN);
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(10);
centeredText(doc, "Inventur alt", 14, fy + 8, fbW);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(doc, "z. B. 10 Stück", 14, fy + 16, fbW);
centeredText(doc, "am Montag", 14, fy + 22, fbW);

doc.setFontSize(20);
doc.setFont("helvetica", "bold");
doc.text("+", 72, fy + 20);

card(doc, 79, fy, fbW, fbH, BLUE);
doc.setFont("helvetica", "bold");
doc.setFontSize(10);
centeredText(doc, "Lieferungen", 79, fy + 8, fbW);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(doc, "z. B. +4 vom", 79, fy + 16, fbW);
centeredText(doc, "Lager geholt", 79, fy + 22, fbW);

doc.setFontSize(20);
doc.setFont("helvetica", "bold");
doc.text("-", 137, fy + 20);

card(doc, 144, fy, fbW, fbH, GREEN);
doc.setFont("helvetica", "bold");
doc.setFontSize(10);
centeredText(doc, "Inventur neu", 144, fy + 8, fbW);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(doc, "z. B. 2 Stück", 144, fy + 16, fbW);
centeredText(doc, "am Sonntag", 144, fy + 22, fbW);

// = VERBRAUCH
card(doc, 60, 95, 90, 22, ORANGE);
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(12);
centeredText(doc, "= 12 Stück Verbrauch", 60, 104, 90);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
centeredText(doc, "in dieser Woche", 60, 112, 90);

arrow(doc, 105, 83, 105, 94);

// → auf 7 Tage normalisiert
card(doc, 40, 135, 130, 26, YELLOW);
doc.setFont("helvetica", "bold");
doc.setFontSize(12);
centeredText(doc, "→ Bestellvorschlag nächste Woche: 12 Stück", 40, 145, 130);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
centeredText(
  doc,
  "auf 7 Tage gerechnet, auch wenn Inventur 8-10 Tage zurückliegt",
  40,
  153,
  130
);

arrow(doc, 105, 119, 105, 134);

// Optional: Reserve-Aufschlag
card(doc, 14, 180, 182, 28, WHITE);
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text("Optional: Reserve-Aufschlag", 18, 189);
doc.setFont("helvetica", "normal");
doc.setFontSize(9.5);
doc.text('Im Switch "Reserve" rechts oben aktivieren und z. B. "+20%" eintragen.', 18, 196);
doc.text("Dann wird der Vorschlag um 20 % erhöht — als Sicherheitspuffer.", 18, 201);
doc.text("Beispiel: aus 12 Stück wird 15 Stück (aufgerundet).", 18, 206);

// Hinweis-Box
card(doc, 14, 218, 182, 32, GRAY);
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text("Wichtig zu wissen", 18, 227);
doc.setFont("helvetica", "normal");
doc.setFontSize(9.5);
doc.text(
  "• Je öfter du inventierst, desto genauer die Vorschläge.",
  18,
  234
);
doc.text(
  "• Lieferungen vom Lager werden automatisch erkannt — nichts extra zu tun.",
  18,
  240
);
doc.text(
  "• Schwund im Lager wird separat dokumentiert (/admin/shrinkage), nicht als Verbrauch.",
  18,
  246
);

footer(doc, 4, TOTAL_PAGES);

// ============================================================
// PAGE 5 — Die Admin-Menüs
// ============================================================
doc.addPage();
pageTitle(doc, "Das Admin-Menü", "Was ist wo — auf einen Blick");

const menus = [
  {
    group: "Alltag",
    color: GREEN,
    items: [
      ["Bedarf & Bestellen", "Tägliche Bestell-Zentrale — hier passiert 90 %"],
      ["Bestellungen → Lieferungen", "Offene Lieferungen einbuchen"],
      ["Kunden-Bestellungen", "Bestellungen vom Chatbot (ohne Login)"],
      ["Backstube", "Bestellungen sortiert nach Abholtag"],
    ],
  },
  {
    group: "Stammdaten",
    color: BLUE,
    items: [
      ["Produkte", "Artikel anlegen, Metro-Daten pflegen"],
      ["Standorte", "Filialen & Platzerl verwalten"],
      ["Benutzer", "Logins zuordnen"],
    ],
  },
  {
    group: "Monitoring (optional)",
    color: ORANGE,
    items: [
      ["Übersicht", "Stand aller Filialen auf einen Blick"],
      ["Inventur-Sessions", "Wann wurde wo gezählt?"],
      ["Schwund · Lager", "Fehlmengen bei Lager-Inventur verbuchen"],
      ["Artikel-Tracking", "Bewegungshistorie pro Artikel"],
    ],
  },
];

let my = 42;
menus.forEach((m) => {
  // Group title bar
  setFill(doc, m.color);
  setDraw(doc, BLACK);
  doc.setLineWidth(0.6);
  doc.rect(14, my, 182, 9, "FD");
  setText(doc, BLACK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(m.group, 18, my + 6.5);
  my += 9;

  m.items.forEach(([name, desc], i) => {
    if (i % 2 === 0) {
      setFill(doc, GRAY);
      doc.rect(14, my, 182, 11, "F");
    }
    setDraw(doc, BLACK);
    doc.setLineWidth(0.2);
    doc.rect(14, my, 182, 11);
    setText(doc, BLACK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(name, 18, my + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(doc, DARK);
    doc.text(desc, 85, my + 7);
    my += 11;
  });
  my += 3;
});

// Tipp am Ende
card(doc, 14, my + 2, 182, 20, YELLOW);
setText(doc, BLACK);
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text("Tipp", 18, my + 10);
doc.setFont("helvetica", "normal");
doc.setFontSize(9.5);
doc.text(
  "Monitoring ist standardmäßig ausgeblendet. Im linken Menü unten mit dem",
  18,
  my + 15.5
);
doc.text('"Monitoring & Debug"-Switch einblenden.', 18, my + 19.5);

footer(doc, 5, TOTAL_PAGES);

// ----- write file -------------------------------------------------------
const buf = Buffer.from(doc.output("arraybuffer"));
writeFileSync(OUT, buf);
console.log(`✓ written ${OUT} (${buf.length.toLocaleString()} bytes)`);
