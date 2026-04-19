import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Audit-Log Helper.
 *
 * Wird in API-Routes nach Erfolg/Fehler aufgerufen. Schreibt in
 * `public.admin_audit_log` mit dem Service-Role-Client (RLS bypass).
 *
 * Schluckt eigene Fehler, damit Logging niemals den eigentlichen Request
 * stoeren kann ("fire and forget"). Wenn es fehlschlaegt, wird ein
 * `console.warn` ausgegeben.
 *
 * Tabelle wird angelegt durch `supabase/admin_audit_log.sql`.
 */
export type AuditEntry = {
  /** kurze Action-ID, z.B. "orders.archive_location", "orders.confirm_delivery" */
  action: string;
  /** wer/was loeste die Action aus, z.B. "admin", "cron", IP, oder Locationname */
  actor?: string | null;
  /** optional: betroffene Location-ID, falls relevant */
  locationId?: string | null;
  /** Eingangs-Payload (gekuerzt/sanitisiert) */
  payload?: unknown;
  /** Ergebnis-Objekt (kann null sein) */
  result?: unknown;
  /** war die Action erfolgreich? */
  ok: boolean;
  /** Fehlerbeschreibung, falls ok=false */
  error?: string | null;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("admin_audit_log").insert({
      action: entry.action,
      actor: entry.actor ?? null,
      location_id: entry.locationId ?? null,
      payload: entry.payload ?? null,
      result: entry.result ?? null,
      ok: Boolean(entry.ok),
      error: entry.error ?? null,
    });
    if (error) {
      // Tabelle nicht angelegt? Migration noch nicht ausgefuehrt? Nur warnen.
      console.warn("[auditLog] insert failed:", error.message);
    }
  } catch (e: unknown) {
    console.warn("[auditLog] unexpected:", e);
  }
}

/** Hilfsfunktion: Actor-String aus einem Request lesen (Header > IP-Hint > "unknown"). */
export function actorFromRequest(request: Request): string {
  const headerActor = request.headers.get("x-actor")?.trim();
  if (headerActor) return headerActor.slice(0, 80);
  const fwd = request.headers.get("x-forwarded-for")?.trim();
  if (fwd) return `ip:${fwd.split(",")[0].trim()}`;
  return "unknown";
}
