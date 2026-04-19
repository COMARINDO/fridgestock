import { NextResponse } from "next/server";
import { archiveOrderForLocationServer } from "@/lib/serverOps";
import { getServerActionSecret } from "@/lib/serverActionSecret";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const expected = getServerActionSecret();
    if (!expected) {
      return NextResponse.json(
        { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET muss gesetzt sein." },
        { status: 500 }
      );
    }

    let body: {
      adminCode?: string;
      locationId?: string;
      items?: Array<{ product_id?: string; quantity?: number }>;
      closeOpenRequests?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const locationId = (body.locationId ?? "").trim();
    if (!locationId) {
      return NextResponse.json({ ok: false, error: "locationId fehlt." }, { status: 400 });
    }

    const items = Array.isArray(body.items)
      ? body.items.map((it) => ({
          product_id: String(it?.product_id ?? "").trim(),
          quantity: Math.max(0, Math.floor(Number(it?.quantity) || 0)),
        }))
      : [];

    const result = await archiveOrderForLocationServer({
      locationId,
      items,
      closeOpenRequests: Boolean(body.closeOpenRequests),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Konnte Bestellung nicht archivieren.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
