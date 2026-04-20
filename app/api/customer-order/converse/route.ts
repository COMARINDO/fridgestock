import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ipFromRequest, rateLimit } from "@/lib/rateLimit";
import {
  aiBrainEnabled,
  fieldOrderIndex,
  nextFieldFromState,
  runBrain,
  type BrainResult,
  type ChatField,
  type ChatState,
  type LocationInfo,
  type ProductInfo,
} from "@/lib/customerChatBrain";
import { getStaticPrompt, type ChatStep } from "@/lib/customerChatTexts";

export const runtime = "nodejs";

const MAIN_LOCATION_NAMES = new Set([
  "Hofstetten",
  "Teich",
  "Rabenstein",
  "Kirchberg",
]);

type Msg = { role: "user" | "assistant"; content: string };

type Body = {
  state?: ChatState;
  message?: string;
  history?: Msg[];
};

type ConverseResponse = {
  ok: true;
  state: ChatState;
  bot_message: string;
  next_field: ChatField | "summary" | "complete";
  needs_location_picker: boolean;
  ai_used: boolean;
};

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const rl = rateLimit(`customer-converse:${ip}`, {
    limit: 60,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Zu viele Anfragen. Bitte später erneut." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const incomingState = sanitizeState(body.state ?? {});
  const message = (body.message ?? "").toString().slice(0, 500);
  const history = sanitizeHistory(body.history ?? []);

  let locations: LocationInfo[] = [];
  let products: ProductInfo[] = [];
  try {
    const supabase = getSupabaseAdmin();

    const { data: locRows, error: locErr } = await supabase
      .from("locations")
      .select("id,name");
    if (locErr) throw locErr;
    locations = (locRows ?? [])
      .filter((l: { name: string }) => MAIN_LOCATION_NAMES.has(l.name))
      .map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }));

    if (aiBrainEnabled()) {
      const { data: prodRows } = await supabase
        .from("products")
        .select("id, brand, product_name, zusatz")
        .order("brand")
        .limit(300);
      products = (prodRows ?? []).map(
        (p: {
          id: string;
          brand: string | null;
          product_name: string | null;
          zusatz: string | null;
        }) => ({
          id: p.id,
          display_name: [p.brand, p.product_name, p.zusatz]
            .map((s) => (s ?? "").trim())
            .filter(Boolean)
            .join(" - "),
        })
      );
    }

    if (incomingState.location_id) {
      const match = locations.find((l) => l.id === incomingState.location_id);
      if (match) incomingState.location_name = match.name;
    }
  } catch (e: unknown) {
    const messageErr =
      e instanceof Error ? e.message : "Datenfehler.";
    return NextResponse.json(
      { ok: false, error: messageErr },
      { status: 500 }
    );
  }

  const state = { ...incomingState };

  const brain = aiBrainEnabled()
    ? await runBrain({
        state,
        history,
        userMessage: message,
        products,
        locations,
      })
    : null;

  let result: ConverseResponse;
  if (brain) {
    const merged = mergeState(state, brain.extracted);
    const nextField = chooseNextField(merged, brain);
    result = {
      ok: true,
      state: merged,
      bot_message: brain.bot_message,
      next_field: nextField,
      needs_location_picker: nextField === "location",
      ai_used: true,
    };
  } else {
    result = staticConverse({ state, message, locations });
  }

  return NextResponse.json(result);
}

function sanitizeState(input: ChatState): ChatState {
  const out: ChatState = {};
  if (typeof input.product === "string" && input.product.trim()) {
    out.product = input.product.trim().slice(0, 200);
  }
  if (
    typeof input.quantity === "number" &&
    Number.isFinite(input.quantity) &&
    input.quantity > 0
  ) {
    out.quantity = Math.min(9999, Math.floor(input.quantity));
  }
  if (typeof input.name === "string" && input.name.trim()) {
    out.name = input.name.trim().slice(0, 120);
  }
  if (typeof input.phone === "string" && input.phone.trim()) {
    const cleaned = input.phone.trim().replace(/[^+0-9()\s\-/.]/g, "");
    if (cleaned.length >= 4) out.phone = cleaned.slice(0, 40);
  }
  if (typeof input.pickup_time === "string" && input.pickup_time.trim()) {
    out.pickup_time = input.pickup_time.trim().slice(0, 120);
  }
  if (typeof input.location_id === "string" && input.location_id.trim()) {
    out.location_id = input.location_id.trim().slice(0, 64);
  }
  return out;
}

function sanitizeHistory(history: Msg[]): Msg[] {
  return history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, 400) }))
    .slice(-12);
}

function mergeState(prev: ChatState, patch: Partial<ChatState>): ChatState {
  return {
    product: patch.product ?? prev.product,
    quantity: patch.quantity ?? prev.quantity,
    name: patch.name ?? prev.name,
    phone: patch.phone ?? prev.phone,
    pickup_time: patch.pickup_time ?? prev.pickup_time,
    location_id: patch.location_id ?? prev.location_id,
    location_name: prev.location_name,
  };
}

function chooseNextField(
  merged: ChatState,
  brain: BrainResult
): ChatField | "summary" | "complete" {
  // Wenn die KI nur eine Rueckfrage beantwortet hat, NICHT den Schritt
  // ueberspringen, sondern beim aktuellen offenen Feld bleiben.
  if (brain.is_clarification) {
    return nextFieldFromState(merged);
  }
  // Wenn KI ein Feld vorschlaegt, das schon gefuellt ist oder weiter
  // hinten liegt als das naechste offene Feld, korrigieren wir auf das
  // erste offene Feld -> User kann nicht uebersprungen werden.
  const stateNext = nextFieldFromState(merged);
  if (stateNext === "summary") return "summary";
  const aiNext = brain.next_field;
  if (aiNext === "summary" || aiNext === "complete") return aiNext;
  // Beide haben einen ChatField-Wert: nimm den frueheren (= sicherer)
  const aiIdx = fieldOrderIndex(aiNext);
  const stateIdx = fieldOrderIndex(stateNext);
  return aiIdx >= 0 && aiIdx < stateIdx ? aiNext : stateNext;
}

function staticConverse(args: {
  state: ChatState;
  message: string;
  locations: LocationInfo[];
}): ConverseResponse {
  const next = nextFieldFromState(args.state);
  // Wenn es der Initial-Call ist (keine Nachricht), liefern wir nur die
  // Frage. Sonst nehmen wir die Nachricht als Wert fuer das aktuell offene
  // Feld - exakt wie der bisherige strenge Flow.
  const mergedState: ChatState = { ...args.state };
  let next_field: ChatField | "summary" = next;

  if (args.message.trim() && next !== "summary") {
    const v = args.message.trim();
    if (next === "product") mergedState.product = v.slice(0, 200);
    else if (next === "quantity") {
      const n = Number.parseInt(v.replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(n) && n > 0) mergedState.quantity = Math.min(9999, n);
    } else if (next === "name") mergedState.name = v.slice(0, 120);
    else if (next === "phone") {
      const cleaned = v.replace(/[^+0-9()\s\-/.]/g, "");
      if (cleaned.length >= 4) mergedState.phone = cleaned.slice(0, 40);
    } else if (next === "pickup_time") mergedState.pickup_time = v.slice(0, 120);
    next_field = nextFieldFromState(mergedState);
  }

  if (next_field === "summary") {
    return {
      ok: true,
      state: mergedState,
      bot_message: "Danke! Hier deine Zusammenfassung:",
      next_field: "summary",
      needs_location_picker: false,
      ai_used: false,
    };
  }

  const stepKey: ChatStep =
    next_field === "location" ? "location" : (next_field as ChatStep);
  const text = getStaticPrompt(stepKey, {
    product: mergedState.product,
    quantity: mergedState.quantity,
    name: mergedState.name,
    phone: mergedState.phone,
    pickup_time: mergedState.pickup_time,
    locationName: mergedState.location_name,
  });

  return {
    ok: true,
    state: mergedState,
    bot_message: text,
    next_field,
    needs_location_picker: next_field === "location",
    ai_used: false,
  };
}
