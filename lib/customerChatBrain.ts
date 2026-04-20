/**
 * KI-Brain fuer den Kunden-Bestell-Chat.
 *
 * Verantwortlich fuer:
 *  - Aus Freitext mehrere Felder gleichzeitig extrahieren
 *    ("2 vollkornbrote fuer morgen 14 uhr in hofstetten")
 *  - Tippfehler / Umgangssprache tolerieren ("morgn", "3 stk", "vk-brot")
 *  - Produktnamen tolerant gegen die DB-Liste matchen
 *  - Auf zwischenliegende Rueckfragen antworten ("habt ihr Vollkorn?")
 *    OHNE den Zustand zu zerstoeren oder Daten zu erfinden
 *  - Den naechsten zu fragenden Schritt vorschlagen
 *
 * Wichtig: Die KI darf KEINE eigenmaechtigen Bestellungen abschicken,
 * keine Locations erfinden, keine Produkte halluzinieren. Validierung
 * passiert ALLES server-seitig nach diesem Call.
 *
 * Server-only.
 */

export type ChatField =
  | "product"
  | "quantity"
  | "name"
  | "phone"
  | "pickup_time"
  | "location";

export type ChatState = {
  product?: string;
  quantity?: number;
  name?: string;
  phone?: string;
  pickup_time?: string;
  location_id?: string;
  /** Anzeigename der bereits gewaehlten Location (wir geben den der KI mit, falls gesetzt). */
  location_name?: string;
};

export type ProductInfo = {
  id: string;
  /** Sprechender Name (z.B. "Hofbauer Vollkornbrot 1kg"). */
  display_name: string;
};

export type LocationInfo = { id: string; name: string };

export type BrainResult = {
  /** Welche Felder die KI aus der Eingabe extrahiert hat. Nur gefuellte Werte. */
  extracted: Partial<ChatState>;
  /** Naechste Frage / Antwort an den User. Immer ein Satz, freundlich. */
  bot_message: string;
  /** Welches Feld als naechstes gefragt werden soll (oder summary). */
  next_field: ChatField | "summary" | "complete";
  /** True, wenn die KI nicht extrahiert hat sondern nur eine Rueckfrage des Users beantwortet hat. */
  is_clarification: boolean;
  /** Optional: matching info, falls die KI das product an einen DB-Eintrag gemappt hat. */
  matched_product_id?: string;
};

export function aiBrainEnabled(): boolean {
  return (
    (process.env.CUSTOMER_CHAT_AI ?? "").trim() === "1" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

const SYSTEM_PROMPT = `Du bist ein freundlicher, kurz angebundener Assistent in einem
Bestell-Chatbot einer oesterreichischen Baeckerei. Du sprichst Deutsch
(Du-Form, herzlich, knapp, KEINE Emojis).

Deine Aufgabe:
1. Extrahiere aus der letzten User-Nachricht so viele Bestelldaten wie
   moeglich (Produkt, Menge, Name, Telefon, Abholzeit, Filiale).
2. Tolerantes Verstehen: Tippfehler, Abkuerzungen ("3 stk", "vk-brot",
   "morgn 14h") sind ok. Korrigiere still im Hintergrund.
3. Produkt-Matching: wenn die User-Eingabe einem Produkt aus der
   PRODUKTLISTE aehnelt, uebernimm den exakten display_name des Treffers.
   Bei Unsicherheit: erste plausible Variante uebernehmen, NICHT erfinden.
4. Filiale: nur eine ID aus der LOCATIONS-Liste setzen. NIE eine ID
   ausdenken. Wenn der User nur einen Filialnamen sagt, mappe ihn auf
   die passende ID.
5. Rueckfragen des Users (z.B. "habt ihr Vollkornbrot?", "wann macht
   ihr auf?") freundlich beantworten - aber nur mit Infos, die du aus
   der PRODUKTLISTE oder dem Kontext sicher hast. Bei Unsicherheit
   ehrlich sagen "weiss ich leider nicht, ruf gerne an".
6. Naechster Schritt: schlage das NAECHSTE noch leere Pflichtfeld vor
   (Reihenfolge: product, quantity, name, phone, pickup_time, location).
   Sind alle gefuellt -> next_field = "summary".

Antworte AUSSCHLIESSLICH im vorgegebenen JSON-Schema. Kein Smalltalk,
keine doppelten Saetze. bot_message ist der Text, den der User sieht.`;

type OpenAiMessage = { role: "system" | "user" | "assistant"; content: string };

const RESPONSE_SCHEMA = {
  name: "chat_brain_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      extracted: {
        type: "object",
        additionalProperties: false,
        properties: {
          product: { type: ["string", "null"] },
          quantity: { type: ["integer", "null"] },
          name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          pickup_time: { type: ["string", "null"] },
          location_id: { type: ["string", "null"] },
        },
        required: [
          "product",
          "quantity",
          "name",
          "phone",
          "pickup_time",
          "location_id",
        ],
      },
      bot_message: { type: "string" },
      next_field: {
        type: "string",
        enum: [
          "product",
          "quantity",
          "name",
          "phone",
          "pickup_time",
          "location",
          "summary",
          "complete",
        ],
      },
      is_clarification: { type: "boolean" },
      matched_product_id: { type: ["string", "null"] },
    },
    required: [
      "extracted",
      "bot_message",
      "next_field",
      "is_clarification",
      "matched_product_id",
    ],
  },
} as const;

function buildContextBlock(
  state: ChatState,
  products: ProductInfo[],
  locations: LocationInfo[]
): string {
  const stateLines: string[] = [];
  if (state.product) stateLines.push(`product: ${state.product}`);
  if (typeof state.quantity === "number") stateLines.push(`quantity: ${state.quantity}`);
  if (state.name) stateLines.push(`name: ${state.name}`);
  if (state.phone) stateLines.push(`phone: ${state.phone}`);
  if (state.pickup_time) stateLines.push(`pickup_time: ${state.pickup_time}`);
  if (state.location_id) {
    stateLines.push(
      `location_id: ${state.location_id}` +
        (state.location_name ? ` (${state.location_name})` : "")
    );
  }
  const stateBlock = stateLines.length > 0 ? stateLines.join("\n") : "(noch leer)";

  const productList = products
    .slice(0, 200)
    .map((p) => `- ${p.id} :: ${p.display_name}`)
    .join("\n");
  const locationList = locations.map((l) => `- ${l.id} :: ${l.name}`).join("\n");

  return [
    "AKTUELLER STATE:",
    stateBlock,
    "",
    "PRODUKTLISTE (id :: display_name):",
    productList || "(keine Produkte verfuegbar)",
    "",
    "LOCATIONS (id :: name):",
    locationList,
  ].join("\n");
}

function sanitizeExtracted(
  raw: Partial<ChatState> & {
    product?: string | null;
    quantity?: number | null;
    name?: string | null;
    phone?: string | null;
    pickup_time?: string | null;
    location_id?: string | null;
  },
  locations: LocationInfo[]
): Partial<ChatState> {
  const out: Partial<ChatState> = {};
  if (typeof raw.product === "string" && raw.product.trim()) {
    out.product = raw.product.trim().slice(0, 200);
  }
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && raw.quantity > 0) {
    out.quantity = Math.min(9999, Math.floor(raw.quantity));
  }
  if (typeof raw.name === "string" && raw.name.trim()) {
    out.name = raw.name.trim().slice(0, 120);
  }
  if (typeof raw.phone === "string" && raw.phone.trim()) {
    const cleaned = raw.phone.trim().replace(/[^+0-9()\s\-/.]/g, "");
    if (cleaned.length >= 4) out.phone = cleaned.slice(0, 40);
  }
  if (typeof raw.pickup_time === "string" && raw.pickup_time.trim()) {
    out.pickup_time = raw.pickup_time.trim().slice(0, 120);
  }
  if (typeof raw.location_id === "string" && raw.location_id.trim()) {
    const id = raw.location_id.trim();
    const found = locations.find((l) => l.id === id);
    if (found) out.location_id = id;
  }
  return out;
}

export async function runBrain(args: {
  state: ChatState;
  history: OpenAiMessage[];
  userMessage: string;
  products: ProductInfo[];
  locations: LocationInfo[];
}): Promise<BrainResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();

  const ctx = buildContextBlock(args.state, args.products, args.locations);
  const messages: OpenAiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: ctx },
    ...args.history.slice(-8),
    { role: "user", content: args.userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 350,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[customerChatBrain] openai error", res.status, await safeText(res));
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;
    let parsed: {
      extracted: Partial<ChatState> & {
        product?: string | null;
        quantity?: number | null;
        name?: string | null;
        phone?: string | null;
        pickup_time?: string | null;
        location_id?: string | null;
      };
      bot_message: string;
      next_field: BrainResult["next_field"];
      is_clarification: boolean;
      matched_product_id?: string | null;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[customerChatBrain] could not parse JSON:", raw.slice(0, 200));
      return null;
    }

    const extracted = sanitizeExtracted(parsed.extracted ?? {}, args.locations);
    const bot_message = (parsed.bot_message ?? "").trim().slice(0, 500);
    if (!bot_message) return null;

    return {
      extracted,
      bot_message,
      next_field: parsed.next_field ?? nextFieldFromState({ ...args.state, ...extracted }),
      is_clarification: Boolean(parsed.is_clarification),
      matched_product_id:
        typeof parsed.matched_product_id === "string"
          ? parsed.matched_product_id
          : undefined,
    };
  } catch (e: unknown) {
    console.warn("[customerChatBrain] failed:", e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 300);
  } catch {
    return "";
  }
}

const FIELD_ORDER: ChatField[] = [
  "product",
  "quantity",
  "name",
  "phone",
  "pickup_time",
  "location",
];

export function nextFieldFromState(state: ChatState): ChatField | "summary" {
  if (!state.product) return "product";
  if (typeof state.quantity !== "number" || state.quantity <= 0) return "quantity";
  if (!state.name) return "name";
  if (!state.phone) return "phone";
  if (!state.pickup_time) return "pickup_time";
  if (!state.location_id) return "location";
  return "summary";
}

export function fieldOrderIndex(f: ChatField): number {
  return FIELD_ORDER.indexOf(f);
}
