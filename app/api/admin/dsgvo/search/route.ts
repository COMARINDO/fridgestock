import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

/**
 * DSGVO Art. 15 (Auskunft) – Suche nach Kundenbestellungen einer Person.
 *
 * Eingabe: Telefonnummer und/oder Name (mind. eines von beiden). Server
 * vergleicht case-insensitiv per `ilike`. Das Ergebnis wird unverschluesselt
 * an den Admin zurueckgegeben, ist aber nur mit dem SERVER_ACTION_SECRET
 * (Admin-Code) erreichbar.
 */
export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  const expected = getServerActionSecret();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Server-Konfiguration: SERVER_ACTION_SECRET fehlt." },
      { status: 500 }
    );
  }

  let body: { adminCode?: string; phone?: string; name?: string };
  try {
    body = (await request.json()) as {
      adminCode?: string;
      phone?: string;
      name?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const adminCode = (body.adminCode ?? "").trim();
  if (!adminCode || adminCode !== expected) {
    await logAudit({ action: "dsgvo.search", actor, ok: false, error: "Unauthorized" });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  const phone = (body.phone ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!phone && !name) {
    return NextResponse.json(
      { ok: false, error: "Bitte Telefonnummer oder Name angeben." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("customer_orders")
      .select(
        "id, product, quantity, name, phone, pickup_time, location_id, status, notes, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (phone && name) {
      query = query.or(`phone.ilike.%${phone}%,name.ilike.%${name}%`);
    } else if (phone) {
      query = query.ilike("phone", `%${phone}%`);
    } else {
      query = query.ilike("name", `%${name}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    await logAudit({
      action: "dsgvo.search",
      actor,
      payload: { phone_prefix: phone.slice(0, 4), name_prefix: name.slice(0, 4) },
      ok: true,
      result: { count: data?.length ?? 0 },
    });

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Suche fehlgeschlagen.";
    await logAudit({ action: "dsgvo.search", actor, ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
