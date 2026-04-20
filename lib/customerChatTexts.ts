/**
 * Frage-Texte fuer den Kunden-Bestell-Chatbot (/order).
 *
 * Default: statische, freundliche Texte (kein API-Call, sofortige Antwort).
 * Optional: KI generiert variierende Texte (`CUSTOMER_CHAT_AI=1` + `OPENAI_API_KEY`).
 *
 * Wichtig: Reihenfolge und Bedeutung der Steps sind FIX. KI darf NUR den
 * Wortlaut variieren, nicht die Frage-Logik aendern.
 *
 * Server-only.
 */

export type ChatStep =
  | "product"
  | "quantity"
  | "name"
  | "phone"
  | "pickup_time"
  | "location";

export type ChatContext = {
  product?: string;
  quantity?: number;
  name?: string;
  phone?: string;
  pickup_time?: string;
  /** Anzeigename der gewaehlten Location (optional, fuer Location-Step). */
  locationName?: string;
};

const STATIC_PROMPTS: Record<ChatStep, (ctx: ChatContext) => string> = {
  product: () => "Hallo! Was möchtest du gerne bestellen?",
  quantity: (ctx) =>
    ctx.product
      ? `Super, ${ctx.product}. Wie viele Stück hättest du gerne?`
      : "Wie viele Stück hättest du gerne?",
  name: () => "Auf welchen Namen soll die Bestellung laufen?",
  phone: (ctx) =>
    ctx.name
      ? `Danke, ${ctx.name}. Unter welcher Telefonnummer können wir dich erreichen?`
      : "Unter welcher Telefonnummer können wir dich erreichen?",
  pickup_time: () =>
    "Wann möchtest du abholen? Du kannst frei schreiben, z. B. „morgen 14:00“ oder „Freitag Vormittag“.",
  location: () => "Letzte Frage: In welcher Filiale möchtest du abholen?",
};

function aiEnabled(): boolean {
  return (
    (process.env.CUSTOMER_CHAT_AI ?? "").trim() === "1" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

const SYSTEM_PROMPT = `Du bist ein freundlicher, knapper Assistent in einem Bestell-Chatbot
einer Bäckerei. Du sprichst Deutsch (Du-Form, locker, herzlich).
Antworte mit GENAU EINEM Satz (max. 20 Wörter, kein Smalltalk, keine Emojis,
keine Vorschläge), der die naechste Frage stellt. Stelle KEINE Rueckfragen,
biete KEINE Alternativen, fasse NICHTS zusammen.`;

const STEP_INTENT: Record<ChatStep, string> = {
  product: "Frage, was der Kunde bestellen moechte.",
  quantity: "Frage nach der gewuenschten Stueckzahl.",
  name: "Frage nach dem Namen, auf den die Bestellung laufen soll.",
  phone: "Frage nach der Telefonnummer.",
  pickup_time: "Frage nach der gewuenschten Abholzeit (Freitext erlaubt).",
  location: "Frage nach der gewuenschten Abhol-Filiale.",
};

async function generateAiPrompt(
  step: ChatStep,
  ctx: ChatContext
): Promise<string | null> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const model = (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();
    const ctxLines: string[] = [];
    if (ctx.product) ctxLines.push(`Produkt: ${ctx.product}`);
    if (typeof ctx.quantity === "number") ctxLines.push(`Menge: ${ctx.quantity}`);
    if (ctx.name) ctxLines.push(`Name: ${ctx.name}`);
    if (ctx.phone) ctxLines.push(`Telefon: ${ctx.phone}`);
    if (ctx.pickup_time) ctxLines.push(`Abholzeit: ${ctx.pickup_time}`);

    const userPrompt = [
      `Naechster Schritt: ${step}.`,
      `Aufgabe: ${STEP_INTENT[step]}`,
      ctxLines.length > 0 ? `Bisheriger Kontext:\n${ctxLines.join("\n")}` : "",
      "Formuliere die Frage in EINEM kurzen Satz.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 60,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));

    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    // Zur Sicherheit auf einen Satz/eine Zeile beschraenken
    return text.split(/\n+/)[0].slice(0, 240);
  } catch {
    return null;
  }
}

export async function getChatPrompt(
  step: ChatStep,
  ctx: ChatContext
): Promise<string> {
  if (aiEnabled()) {
    const ai = await generateAiPrompt(step, ctx);
    if (ai) return ai;
  }
  return STATIC_PROMPTS[step](ctx);
}

export function getStaticPrompt(step: ChatStep, ctx: ChatContext): string {
  return STATIC_PROMPTS[step](ctx);
}
