import { NextResponse } from "next/server";
import { getChatPrompt, type ChatStep } from "@/lib/customerChatTexts";

export const runtime = "nodejs";

const VALID_STEPS: ChatStep[] = [
  "product",
  "quantity",
  "name",
  "phone",
  "pickup_time",
  "location",
];

function isStep(value: string): value is ChatStep {
  return (VALID_STEPS as string[]).includes(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      step?: string;
      context?: {
        product?: string;
        quantity?: number;
        name?: string;
        phone?: string;
        pickup_time?: string;
        locationName?: string;
      };
    };
    const stepRaw = (body.step ?? "").trim();
    if (!isStep(stepRaw)) {
      return NextResponse.json({ ok: false, error: "Invalid step" }, { status: 400 });
    }
    const text = await getChatPrompt(stepRaw, body.context ?? {});
    return NextResponse.json({ ok: true, text });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "prompt failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
