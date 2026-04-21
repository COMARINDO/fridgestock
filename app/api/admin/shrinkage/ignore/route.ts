import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  let id = "";
  try {
    const expected = getServerActionSecret();
    if (!expected) {
      return NextResponse.json(
        { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET fehlt." },
        { status: 500 }
      );
    }

    let body: { adminCode?: string; id?: string; note?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
    const adminCode = (body.adminCode ?? "").trim();
    if (!adminCode || adminCode !== expected) {
      await logAudit({
        action: "inventory.shrinkage.ignore",
        actor,
        ok: false,
        error: "Unauthorized",
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    id = (body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "id fehlt." }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("inventory_discrepancies")
      .update({
        status: "ignored",
        note: note,
      })
      .eq("id", id)
      .select("id, location_id, product_id, shrink_quantity, status")
      .single();
    if (error) throw error;

    await logAudit({
      action: "inventory.shrinkage.ignore",
      actor,
      locationId: data?.location_id ?? null,
      payload: { id, note, shrink: data?.shrink_quantity ?? null },
      ok: true,
    });
    return NextResponse.json({ ok: true, item: data });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Konnte Schwund nicht ignorieren.";
    await logAudit({
      action: "inventory.shrinkage.ignore",
      actor,
      payload: { id },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
