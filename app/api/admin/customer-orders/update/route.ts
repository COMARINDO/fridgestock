import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set(["open", "confirmed", "forwarded", "cancelled"]);

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  const expected = getServerActionSecret();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET fehlt." },
      { status: 500 }
    );
  }

  let body: { adminCode?: string; id?: string; status?: string; notes?: string };
  try {
    body = (await request.json()) as { adminCode?: string; id?: string; status?: string; notes?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const adminCode = (body.adminCode ?? "").trim();
  if (!adminCode || adminCode !== expected) {
    await logAudit({ action: "customer_order.update", actor, ok: false, error: "Unauthorized" });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const id = (body.id ?? "").trim();
  const status = (body.status ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id fehlt." }, { status: 400 });
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "Status ungültig." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const update: Record<string, unknown> = { status };
    if (typeof body.notes === "string") update.notes = body.notes.trim().slice(0, 500) || null;
    const { error } = await supabase
      .from("customer_orders")
      .update(update)
      .eq("id", id);
    if (error) throw error;

    await logAudit({
      action: "customer_order.update",
      actor,
      payload: { id, status },
      ok: true,
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Update fehlgeschlagen.";
    await logAudit({
      action: "customer_order.update",
      actor,
      payload: { id, status },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
