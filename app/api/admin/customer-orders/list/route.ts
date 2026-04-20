import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set(["all", "open", "confirmed", "forwarded", "cancelled"]);

export async function GET(request: Request) {
  const expected = getServerActionSecret();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET fehlt." },
      { status: 500 }
    );
  }
  const url = new URL(request.url);
  const adminCode = (url.searchParams.get("adminCode") ?? "").trim();
  if (!adminCode || adminCode !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  const status = (url.searchParams.get("status") ?? "open").trim();
  const locationId = (url.searchParams.get("locationId") ?? "").trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));

  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("customer_orders")
      .select("id, product, quantity, name, phone, pickup_time, location_id, status, notes, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "all") query = query.eq("status", status);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) throw error;

    const { data: locs } = await supabase.from("locations").select("id,name");
    const locMap = new Map<string, string>();
    (locs ?? []).forEach((l: { id: string; name: string }) => locMap.set(l.id, l.name));

    const items = (data ?? []).map((row) => ({
      ...row,
      location_name: locMap.get(row.location_id) ?? row.location_id,
    }));
    return NextResponse.json({ ok: true, items });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Konnte Kundenbestellungen nicht laden.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
