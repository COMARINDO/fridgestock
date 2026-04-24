/**
 * Parse a Metro delivery-note PDF via OpenAI's Responses API (vision-enabled
 * models can read PDFs directly as input files). Server-only.
 *
 * Returns a normalized list of positions. No DB access; callers map the
 * `metroNr` onto their own product table.
 */

export type DeliveryNotePosition = {
  /** Metro article number as printed on the note (digits only, normalized). */
  metroNr: string | null;
  /** Human-readable article name. */
  name: string;
  /** Delivered quantity in pieces (Stück). Best effort: the model is asked to
   *  multiply packs x units when both are present so callers receive absolute
   *  piece counts. */
  quantity: number;
  /** Raw unit string as seen on the note (e.g. "ST", "KT 12", "KG"), if any. */
  unit: string | null;
};

export type DeliveryNoteParseResult = {
  positions: DeliveryNotePosition[];
  /** Model response id, useful for audit log. */
  responseId: string | null;
};

const MODEL = process.env.OPENAI_DELIVERY_NOTE_MODEL?.trim() || "gpt-4o";

function openAiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY fehlt.");
  return key;
}

const SYSTEM_PROMPT = `Du bist ein Parser für Metro-Lieferscheine (DE/AT).
Extrahiere ALLE Artikelpositionen aus dem PDF als JSON.

Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format (keine Erklärungen, kein Markdown):
{
  "positions": [
    { "metroNr": "1234567", "name": "Artikelbezeichnung", "quantity": 12, "unit": "ST" }
  ]
}

Regeln:
- metroNr: Artikelnummer (nur Ziffern). Wenn keine Nummer erkennbar ist, null.
- name: Die volle Artikelbezeichnung wie auf dem Schein, getrimmt.
- quantity: Die GELIEFERTE Menge in STÜCK (nicht in Kartons/Packs).
  Wenn der Schein "Kolli/Karton" x "Stück pro Karton" enthält, MULTIPLIZIERE.
  Beispiel: 2 Kartons à 12 Stück => quantity 24.
  Wenn nur eine einzige Mengenspalte existiert, nimm diese als quantity.
- unit: Original-Einheit vom Schein ("ST", "KG", "KT 12", etc.) oder null.
- Keine Summenzeilen, keine Verpackungspauschalen, keine Pfandzeilen, keine Rabatt-Zeilen.
- Leere/unklare Zeilen komplett weglassen.`;

type RawPosition = {
  metroNr?: unknown;
  name?: unknown;
  quantity?: unknown;
  unit?: unknown;
};

function normalizeMetroNr(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  return digits.length >= 3 ? digits : null;
}

function coerceNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const normalized = raw.replace(/\s/g, "").replace(",", ".");
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  // Strip potential ```json fences.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  // Fall back to the first '{' ... last '}' slice.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

type OpenAiResponseShape = {
  id?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
};

function extractModelText(payload: OpenAiResponseShape): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const c of item.content ?? []) {
      if ((c.type === "output_text" || c.type === "text") && typeof c.text === "string") {
        chunks.push(c.text);
      }
    }
  }
  return chunks.join("\n");
}

export async function parseDeliveryNotePdf(args: {
  fileBuffer: ArrayBuffer | Uint8Array | Buffer;
  fileName: string;
  mimeType?: string;
  signal?: AbortSignal;
}): Promise<DeliveryNoteParseResult> {
  const key = openAiKey();
  const mime = (args.mimeType ?? "application/pdf").trim() || "application/pdf";
  const buffer =
    args.fileBuffer instanceof Uint8Array
      ? Buffer.from(args.fileBuffer)
      : Buffer.from(args.fileBuffer as ArrayBuffer);
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;
  const fileName = args.fileName && args.fileName.trim() ? args.fileName : "lieferschein.pdf";

  const body = {
    model: MODEL,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Extrahiere alle Positionen aus diesem Metro-Lieferschein als JSON " +
              "(siehe Systemvorgabe). Gib NUR das JSON zurück.",
          },
          { type: "input_file", filename: fileName, file_data: dataUrl },
        ],
      },
    ],
    // Force structured JSON output.
    text: { format: { type: "json_object" } },
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = (await res.json()) as OpenAiResponseShape;
      detail = errBody.error?.message ?? JSON.stringify(errBody);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`OpenAI Lieferschein-Parser: HTTP ${res.status} ${detail}`.trim());
  }

  const payload = (await res.json()) as OpenAiResponseShape;
  const text = extractModelText(payload);
  if (!text.trim()) {
    throw new Error("OpenAI Antwort war leer.");
  }

  let parsed: { positions?: RawPosition[] };
  try {
    parsed = JSON.parse(extractJsonPayload(text)) as { positions?: RawPosition[] };
  } catch (e) {
    throw new Error(
      `OpenAI Antwort konnte nicht als JSON gelesen werden: ${(e as Error).message}`
    );
  }

  const rawList = Array.isArray(parsed.positions) ? parsed.positions : [];
  const positions: DeliveryNotePosition[] = [];
  for (const r of rawList) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const qty = Math.max(0, Math.round(coerceNumber(r.quantity)));
    const unit = typeof r.unit === "string" && r.unit.trim() ? r.unit.trim() : null;
    const metroNr = normalizeMetroNr(r.metroNr);
    if (!name && !metroNr) continue;
    if (qty <= 0) continue;
    positions.push({ metroNr, name, quantity: qty, unit });
  }

  return {
    positions,
    responseId: typeof payload.id === "string" ? payload.id : null,
  };
}
