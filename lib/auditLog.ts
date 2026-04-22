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

/**
 * Anonymisiert eine IP-Adresse, damit wir DSGVO-konform nur einen groben
 * Herkunftshinweis loggen statt eines eindeutigen Personenbezugs.
 *
 * - IPv4: letztes Oktett wird auf 0 gesetzt ("1.2.3.4" -> "1.2.3.0").
 * - IPv6: wir behalten nur die ersten 3 Hextets (/48), Rest auf 0
 *   ("2001:db8:abcd:1234:..." -> "2001:db8:abcd::").
 *
 * Die Funktion ist bewusst robust gegenüber Müll-Eingaben: alles, was weder
 * nach IPv4 noch IPv6 aussieht, wird als Platzhalter "ip:unknown" zurück-
 * gegeben, damit nie eine unverkürzte IP in die Logs gelangt.
 */
export function anonymizeIp(raw: string): string {
  const ip = raw.trim();
  if (!ip) return "ip:unknown";

  // IPv4 (eventuell mit optionalem Port) -> letztes Oktett nullen.
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/);
  if (v4) {
    return `ip:${v4[1]}.${v4[2]}.${v4[3]}.0`;
  }

  // IPv6 (sehr locker geparst). Wenn Klammern dabei sind: weg damit.
  const v6raw = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (v6raw.includes(":")) {
    const head = v6raw.split(":").slice(0, 3).filter(Boolean).join(":");
    return head ? `ip:${head}::` : "ip:unknown";
  }

  return "ip:unknown";
}

/**
 * Hilfsfunktion: Actor-String aus einem Request lesen.
 * Reihenfolge: expliziter `x-actor` Header > anonymisierte Client-IP > "unknown".
 *
 * Wir speichern nur eine <b>anonymisierte</b> IP (siehe {@link anonymizeIp}),
 * damit das Audit-Log keine eindeutige Personenzuordnung enthält. Das ist der
 * DSGVO-konforme Kompromiss zwischen Missbrauchserkennung und Datenminimierung.
 */
export function actorFromRequest(request: Request): string {
  const headerActor = request.headers.get("x-actor")?.trim();
  if (headerActor) return headerActor.slice(0, 80);
  const fwd = request.headers.get("x-forwarded-for")?.trim();
  if (fwd) {
    const first = fwd.split(",")[0]?.trim() ?? "";
    return anonymizeIp(first);
  }
  return "unknown";
}
