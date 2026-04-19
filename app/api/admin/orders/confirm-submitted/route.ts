import { NextResponse } from "next/server";
import { confirmSubmittedOrderDeliveryServer } from "@/lib/serverOps";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  let orderId = "";
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
      await logAudit({
        action: "orders.confirm_delivery",
        actor,
        ok: false,
        error: "Unauthorized",
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }
    orderId = (body.orderId ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId fehlt." }, { status: 400 });
    }

    const result = await confirmSubmittedOrderDeliveryServer(orderId);
    await logAudit({
      action: "orders.confirm_delivery",
      actor,
      payload: { orderId },
      result,
      ok: true,
    });
    return NextResponse.json({
      ok: true,
      appliedItems: result.appliedItems,
      deliveredAt: result.deliveredAt,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Konnte Lieferung nicht bestätigen.";
    await logAudit({
      action: "orders.confirm_delivery",
      actor,
      payload: { orderId: orderId || null },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
