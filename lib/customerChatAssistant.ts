/**
 * OpenAI Assistants v2 integration for the customer order chatbot.
 *
 * We use Assistants for a more flexible conversational layer (answering questions,
 * handling typos, extracting multiple fields at once), but we still keep:
 * - strict server-side validation
 * - deterministic required fields
 * - no hallucinated product/location ids (only from DB lists)
 *
 * Server-only.
 */

import type { ChatField, ChatState, LocationInfo, ProductInfo } from "@/lib/customerChatBrain";
import { nextFieldFromState } from "@/lib/customerChatBrain";

type Role = "user" | "assistant";

export type ConverseHistoryMessage = { role: Role; content: string };

export type AssistantConverseResult = {
  thread_id: string;
  extracted: Partial<ChatState>;
  bot_message: string;
  next_field: ChatField | "summary" | "complete";
  is_clarification: boolean;
};

function assistantEnabled(): boolean {
  return (
    (process.env.CUSTOMER_CHAT_AI ?? "").trim() === "1" &&
    Boolean(process.env.OPENAI_API_KEY) &&
    Boolean((process.env.CUSTOMER_CHAT_ASSISTANT_ID ?? "").trim())
  );
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return key;
}

function assistantId(): string {
  const id = process.env.CUSTOMER_CHAT_ASSISTANT_ID?.trim();
  if (!id) throw new Error("Missing CUSTOMER_CHAT_ASSISTANT_ID");
  return id;
}

async function openai(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey()}`,
      // Assistants v2
      "OpenAI-Beta": "assistants=v2",
      ...(init.headers ?? {}),
    },
  });
}

function toolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "get_shop_info",
        description:
          "Return official shop links (homepage + Facebook) for customer questions.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_products",
        description: "Return the current product list for grounding.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_locations",
        description: "Return the pickup locations list for grounding.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "propose_update",
        description:
          "Propose a structured state patch extracted from the user message and a bot reply. " +
          "Only set location_id to an existing id from get_locations. " +
          "product should be a friendly display name (use product list when possible).",
        parameters: {
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
            is_clarification: { type: "boolean" },
          },
          required: ["extracted", "bot_message", "is_clarification"],
        },
      },
    },
  ] as const;
}

function systemInstructions(currentState: ChatState): string {
  const stateLines: string[] = [];
  stateLines.push("Du bist ein Bestell-Chatbot (Deutsch, Du-Form, knapp, ohne Emojis).");
  stateLines.push("Ziel: Bestell-Daten erfassen und Rueckfragen beantworten.");
  stateLines.push("Du darfst KEINE IDs erfinden. location_id nur aus get_locations.");
  stateLines.push(
    "Bei Fragen nach Links (Homepage/Facebook) nutze get_shop_info und gib nur diese Links aus."
  );
  stateLines.push("Nutze get_products/get_locations nur wenn noetig.");
  stateLines.push("");
  stateLines.push("Pflichtfelder in Reihenfolge: product, quantity, name, phone, pickup_time, location.");
  stateLines.push("Wenn User etwas fragt (Oeffnungszeiten, Verfuegbarkeit): antworte ehrlich, erfinde nichts.");
  stateLines.push("");
  stateLines.push("Aktueller State (bereits bekannt):");
  stateLines.push(JSON.stringify(currentState));
  stateLines.push("");
  stateLines.push(
    "WICHTIG: Am Ende jedes Turns rufe propose_update auf, um extracted + bot_message zu liefern."
  );
  return stateLines.join("\n");
}

function sanitizeExtracted(
  raw: {
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
  if (typeof raw.product === "string" && raw.product.trim()) out.product = raw.product.trim().slice(0, 200);
  if (typeof raw.quantity === "number" && Number.isFinite(raw.quantity) && raw.quantity > 0)
    out.quantity = Math.min(9999, Math.floor(raw.quantity));
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, 120);
  if (typeof raw.phone === "string" && raw.phone.trim()) {
    const cleaned = raw.phone.trim().replace(/[^+0-9()\s\-/.]/g, "");
    if (cleaned.length >= 4) out.phone = cleaned.slice(0, 40);
  }
  if (typeof raw.pickup_time === "string" && raw.pickup_time.trim())
    out.pickup_time = raw.pickup_time.trim().slice(0, 120);
  if (typeof raw.location_id === "string" && raw.location_id.trim()) {
    const id = raw.location_id.trim();
    if (locations.some((l) => l.id === id)) out.location_id = id;
  }
  return out;
}

export function assistantConverseEnabled(): boolean {
  return assistantEnabled();
}

export async function assistantsConverse(args: {
  thread_id?: string | null;
  state: ChatState;
  history: ConverseHistoryMessage[];
  user_message: string;
  products: ProductInfo[];
  locations: LocationInfo[];
}): Promise<AssistantConverseResult | null> {
  if (!assistantEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const threadId = args.thread_id?.trim() || (await createThread(controller.signal));

    // Add user message to thread (we do not replay full history to keep it cheap)
    if (args.user_message.trim()) {
      const r = await openai(`/threads/${encodeURIComponent(threadId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "user", content: args.user_message }),
        signal: controller.signal,
      });
      if (!r.ok) return null;
    }

    // Create run with instructions and tools
    const run = await createRun({
      threadId,
      instructions: systemInstructions(args.state),
      signal: controller.signal,
    });
    if (!run) return null;

    const final = await runUntilComplete({
      threadId,
      runId: run.id,
      products: args.products,
      locations: args.locations,
      signal: controller.signal,
    });
    if (!final) return null;

    const extracted = sanitizeExtracted(final.extracted ?? {}, args.locations);
    const merged: ChatState = {
      product: extracted.product ?? args.state.product,
      quantity: extracted.quantity ?? args.state.quantity,
      name: extracted.name ?? args.state.name,
      phone: extracted.phone ?? args.state.phone,
      pickup_time: extracted.pickup_time ?? args.state.pickup_time,
      location_id: extracted.location_id ?? args.state.location_id,
      location_name: args.state.location_name,
    };

    const next = nextFieldFromState(merged);
    return {
      thread_id: threadId,
      extracted,
      bot_message: (final.bot_message ?? "").trim().slice(0, 600) || "Okay. Was darf ich noch wissen?",
      next_field: next,
      is_clarification: Boolean(final.is_clarification),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getShopInfo(): { homepage_url: string | null; facebook_url: string | null } {
  const homepage = (process.env.BAKERY_HOMEPAGE_URL ?? "").trim();
  const facebook = (process.env.BAKERY_FACEBOOK_URL ?? "").trim();
  return {
    homepage_url: homepage || null,
    facebook_url: facebook || null,
  };
}

async function createThread(signal: AbortSignal): Promise<string> {
  const r = await openai("/threads", { method: "POST", body: JSON.stringify({}), signal });
  if (!r.ok) throw new Error("Failed to create thread");
  const data = (await r.json()) as { id: string };
  return data.id;
}

async function createRun(args: {
  threadId: string;
  instructions: string;
  signal: AbortSignal;
}): Promise<{ id: string } | null> {
  const r = await openai(`/threads/${encodeURIComponent(args.threadId)}/runs`, {
    method: "POST",
    body: JSON.stringify({
      assistant_id: assistantId(),
      instructions: args.instructions,
      tools: toolDefinitions(),
      temperature: 0.2,
    }),
    signal: args.signal,
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { id: string };
  return { id: data.id };
}

async function runUntilComplete(args: {
  threadId: string;
  runId: string;
  products: ProductInfo[];
  locations: LocationInfo[];
  signal: AbortSignal;
}): Promise<{
  extracted: unknown;
  bot_message: string;
  is_clarification: boolean;
} | null> {
  // Capture propose_update deterministically from tool calls.
  let proposed: ProposeUpdatePayload | null = null;

  // Poll loop with tool handling
  for (let i = 0; i < 30; i++) {
    const run = await getRun(args.threadId, args.runId, args.signal);
    if (!run) return null;

    if (run.status === "completed") {
      // Prefer tool-call captured output (reliable). Fallback to parsing assistant message.
      if (proposed) {
        return {
          extracted: proposed.extracted,
          bot_message: proposed.bot_message,
          is_clarification: proposed.is_clarification,
        };
      }
      const latest = await getLatestAssistantMessage(args.threadId, args.signal);
      if (!latest) return null;
      const parsed = tryParseJson(latest);
      if (!isProposeUpdatePayload(parsed)) return null;
      return {
        extracted: parsed.extracted,
        bot_message: parsed.bot_message,
        is_clarification: parsed.is_clarification,
      };
    }

    if (run.status === "requires_action") {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls ?? [];
      const outputs: Array<{ tool_call_id: string; output: string }> = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        if (!name) continue;
        if (name === "get_shop_info") {
          outputs.push({
            tool_call_id: tc.id,
            output: JSON.stringify(getShopInfo()),
          });
        } else if (name === "get_products") {
          outputs.push({
            tool_call_id: tc.id,
            output: JSON.stringify({
              products: args.products.map((p) => ({ id: p.id, display_name: p.display_name })),
            }),
          });
        } else if (name === "get_locations") {
          outputs.push({
            tool_call_id: tc.id,
            output: JSON.stringify({ locations: args.locations }),
          });
        } else if (name === "propose_update") {
          const rawArgs = tc.function?.arguments ?? "{}";
          // The assistant provides arguments; we capture them and ack so the run can continue.
          const parsed = tryParseJson(rawArgs);
          if (isProposeUpdatePayload(parsed)) proposed = parsed;
          outputs.push({ tool_call_id: tc.id, output: rawArgs });
        } else {
          outputs.push({ tool_call_id: tc.id, output: "{}" });
        }
      }
      const ok = await submitToolOutputs(args.threadId, args.runId, outputs, args.signal);
      if (!ok) return null;
      continue;
    }

    if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
      return null;
    }

    // queued / in_progress
    // Polling delay: keep low to reduce perceived latency, but not too low to avoid API spam.
    await sleep(250);
  }
  return null;
}

type RunStatus =
  | "queued"
  | "in_progress"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type ToolCall = {
  id: string;
  function?: { name?: string; arguments?: string };
};

type RunObject = {
  id: string;
  status: RunStatus;
  required_action?: {
    submit_tool_outputs?: {
      tool_calls?: ToolCall[];
    };
  };
};

async function getRun(threadId: string, runId: string, signal: AbortSignal): Promise<RunObject | null> {
  const r = await openai(`/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    signal,
  });
  if (!r.ok) return null;
  return (await r.json()) as RunObject;
}

async function submitToolOutputs(
  threadId: string,
  runId: string,
  outputs: Array<{ tool_call_id: string; output: string }>,
  signal: AbortSignal
): Promise<boolean> {
  const r = await openai(
    `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/submit_tool_outputs`,
    {
      method: "POST",
      body: JSON.stringify({ tool_outputs: outputs }),
      signal,
    }
  );
  return r.ok;
}

async function getLatestAssistantMessage(threadId: string, signal: AbortSignal): Promise<string | null> {
  const r = await openai(`/threads/${encodeURIComponent(threadId)}/messages?limit=10`, {
    method: "GET",
    signal,
  });
  if (!r.ok) return null;
  const data = (await r.json()) as {
    data?: Array<{
      role?: string;
      content?: Array<{ text?: { value?: unknown } }>;
    }>;
  };
  const msgs = data.data ?? [];
  const last = msgs.find((m) => m.role === "assistant");
  const text = last?.content?.[0]?.text?.value;
  return typeof text === "string" ? text : null;
}

function tryParseJson(text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;
  // If assistant wrapped JSON in text, try to find first {...}
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = t.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

type ProposeUpdatePayload = {
  extracted: {
    product: string | null;
    quantity: number | null;
    name: string | null;
    phone: string | null;
    pickup_time: string | null;
    location_id: string | null;
  };
  bot_message: string;
  is_clarification: boolean;
};

function isProposeUpdatePayload(v: unknown): v is ProposeUpdatePayload {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.bot_message !== "string") return false;
  if (typeof obj.is_clarification !== "boolean") return false;
  if (!obj.extracted || typeof obj.extracted !== "object") return false;
  const ex = obj.extracted as Record<string, unknown>;
  const okNullableString = (x: unknown) => x === null || typeof x === "string";
  const okNullableInt = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
  return (
    okNullableString(ex.product) &&
    okNullableInt(ex.quantity) &&
    okNullableString(ex.name) &&
    okNullableString(ex.phone) &&
    okNullableString(ex.pickup_time) &&
    okNullableString(ex.location_id)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

