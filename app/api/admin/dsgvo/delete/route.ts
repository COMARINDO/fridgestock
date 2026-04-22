import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

/**
 * DSGVO Art. 17 (Recht auf Loeschung / "Recht auf Vergessenwerden").
 *
 * Entweder:
 *  - `ids`: Liste konkreter customer_orders-IDs, die geloescht werden sollen.
 *  - `phone`: Alle Bestellungen einer Telefonnummer werden geloescht.
 *
 * Zugriff nur mit gueltigem Admin-Code (SERVER_ACTION_SECRET). Jede Loeschung
 * wird im Audit-Log protokolliert (ohne die personenbezogenen Inhalte selbst,
 * nur Anzahl + IDs), damit wir die Rechenschaftspflicht aus Art. 5 Abs. 2
 * DSGVO erfuellen koennen.
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

  let body: { adminCode?: string; ids?: string[]; phone?: string; reason?: string };
  try {
    body = (await request.json()) as {
      adminCode?: string;
      ids?: string[];
      phone?: string;
      reason?: string;
    };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const adminCode = (body.adminCode ?? "").trim();
  if (!adminCode || adminCode !== expected) {
    await logAudit({ action: "dsgvo.delete", actor, ok: false, error: "Unauthorized" });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  const phone = (body.phone ?? "").trim();

  if (ids.length === 0 && !phone) {
    return NextResponse.json(
      { ok: false, error: "Bitte IDs oder Telefonnummer angeben." },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();

    let deletedIds: string[] = [];
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("customer_orders")
        .delete()
        .in("id", ids)
        .select("id");
      if (error) throw error;
      deletedIds = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      const { data, error } = await supabase
        .from("customer_orders")
        .delete()
        .eq("phone", phone)
        .select("id");
      if (error) throw error;
      deletedIds = (data ?? []).map((r: { id: string }) => r.id);
    }

    await logAudit({
      action: "dsgvo.delete",
      actor,
      payload: {
        reason: (body.reason ?? "").slice(0, 200) || null,
        by_phone: phone ? true : false,
        phone_prefix: phone ? phone.slice(0, 4) : null,
        requested_ids: ids.length,
      },
      result: { deleted_count: deletedIds.length, deleted_ids: deletedIds },
      ok: true,
    });

    return NextResponse.json({
      ok: true,
      deleted_count: deletedIds.length,
      deleted_ids: deletedIds,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Loeschung fehlgeschlagen.";
    await logAudit({ action: "dsgvo.delete", actor, ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
