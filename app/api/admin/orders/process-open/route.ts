import { NextResponse } from "next/server";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { processOpenOrderRequestsServer } from "@/lib/serverOps";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
}

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  try {
    let body: { adminCode?: string };
    try {
      body = (await request.json()) as { adminCode?: string };
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const expectedSecret = getServerActionSecret();
    if (!expectedSecret) {
      return NextResponse.json(
        { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET muss gesetzt sein." },
        { status: 500 }
      );
    }

    const providedCode = body.adminCode?.trim() ?? "";
    if (!providedCode || providedCode !== expectedSecret) {
      await logAudit({
        action: "orders.process_open",
        actor,
        ok: false,
        error: "Unauthorized",
      });
      return unauthorized();
    }

    const result = await processOpenOrderRequestsServer();
    await logAudit({
      action: "orders.process_open",
      actor,
      ok: true,
      result: { processedRows: result.processedRows, processedAt: result.processedAt },
    });
    return NextResponse.json({
      ok: true,
      processedRows: result.processedRows,
      processedAt: result.processedAt,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Konnte Bestellung nicht platzieren.";
    await logAudit({
      action: "orders.process_open",
      actor,
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
