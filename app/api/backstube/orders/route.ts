import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { BACKSTUBE_CODE } from "@/lib/backstubeCode";

export const runtime = "nodejs";

/**
 * Liefert alle relevanten Kundenbestellungen fuer die Backstube-Sicht.
 *
 * Auth: Header `x-backstube-code` muss mit BACKSTUBE_CODE uebereinstimmen.
 * Stornierte Bestellungen werden ausgeblendet; alles andere wird zurueckgegeben,
 * inkl. der Filialnamen, damit der Bach-Plan auf einen Blick erkennbar ist.
 */

export async function GET(request: Request) {
  const provided = request.headers.get("x-backstube-code")?.trim() ?? "";
  if (!provided || provided !== BACKSTUBE_CODE) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: rows, error } = await supabase
      .from("customer_orders")
      .select(
        "id, product, quantity, name, phone, pickup_time, location_id, status, notes, created_at"
      )
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const { data: locs } = await supabase.from("locations").select("id,name");
    const locMap = new Map<string, string>();
    (locs ?? []).forEach((l: { id: string; name: string }) => locMap.set(l.id, l.name));

    const items = (rows ?? []).map((r) => ({
      ...r,
      location_name: locMap.get(r.location_id) ?? r.location_id,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Konnte Bestellungen nicht laden.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
