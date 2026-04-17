import { NextResponse } from "next/server";
import { confirmSubmittedOrderDeliveryServer } from "@/lib/serverOps";
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

    let body: { adminCode?: string; orderId?: string };
    try {
      body = (await request.json()) as { adminCode?: string; orderId?: string };
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }
    const orderId = (body.orderId ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId fehlt." }, { status: 400 });
    }

    const result = await confirmSubmittedOrderDeliveryServer(orderId);
    return NextResponse.json({
      ok: true,
      appliedItems: result.appliedItems,
      deliveredAt: result.deliveredAt,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Konnte Lieferung nicht bestätigen.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
