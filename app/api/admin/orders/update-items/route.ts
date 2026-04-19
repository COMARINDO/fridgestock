import { NextResponse } from "next/server";
import { updateSubmittedOrderItemsServer } from "@/lib/serverOps";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  let orderId = "";
  let itemsCount = 0;
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
      orderId?: string;
      items?: Array<{ product_id?: string; quantity?: number }>;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      await logAudit({
        action: "orders.update_items",
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

    const items = Array.isArray(body.items)
      ? body.items.map((it) => ({
          product_id: String(it?.product_id ?? "").trim(),
          quantity: Math.max(0, Math.floor(Number(it?.quantity) || 0)),
        }))
      : [];
    itemsCount = items.length;

    const result = await updateSubmittedOrderItemsServer({ orderId, items });
    await logAudit({
      action: "orders.update_items",
      actor,
      payload: { orderId, itemsCount },
      result,
      ok: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Konnte Bestellung nicht ändern.";
    await logAudit({
      action: "orders.update_items",
      actor,
      payload: { orderId: orderId || null, itemsCount },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
