import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logAudit } from "@/lib/auditLog";

export const runtime = "nodejs";

/**
 * DSGVO-Cleanup-Endpoint.
 *
 * Loescht regelmaessig:
 * - abgeschlossene Kundenbestellungen nach 90 Tagen
 * - liegengebliebene offene Kundenbestellungen nach 180 Tagen
 * - Admin-Audit-Eintraege nach 180 Tagen
 *
 * Wird per Vercel-Cron aufgerufen (siehe vercel.json). Auth via
 * `Authorization: Bearer <CRON_SECRET>` – gleiches Pattern wie /api/backup.
 *
 * SQL-Funktionen werden in `supabase/dsgvo_cleanup.sql` angelegt.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET fehlt." },
      { status: 500 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: coData, error: coErr } = await supabase.rpc(
      "dsgvo_cleanup_customer_orders",
      { retain_days_done: 90, retain_days_open: 180 }
    );
    if (coErr) throw coErr;

    const { data: alData, error: alErr } = await supabase.rpc(
      "dsgvo_cleanup_admin_audit_log",
      { retain_days: 180 }
    );
    if (alErr) throw alErr;

    const customerOrdersDeleted =
      typeof coData === "number" ? coData : Number(coData ?? 0);
    const auditLogDeleted =
      typeof alData === "number" ? alData : Number(alData ?? 0);

    await logAudit({
      action: "dsgvo.cleanup",
      actor: "cron",
      ok: true,
      result: {
        customer_orders_deleted: customerOrdersDeleted,
        admin_audit_log_deleted: auditLogDeleted,
      },
    });

    return NextResponse.json({
      ok: true,
      customer_orders_deleted: customerOrdersDeleted,
      admin_audit_log_deleted: auditLogDeleted,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "DSGVO-Cleanup fehlgeschlagen.";
    await logAudit({ action: "dsgvo.cleanup", actor: "cron", ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
