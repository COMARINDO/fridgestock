import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * Liefert die zur Auswahl stehenden Pickup-Filialen fuer den Kunden-Chat.
 * Bewusst eine eigene Route mit Service-Role, damit wir die Anzeige-Liste
 * filtern koennen (z.B. keine Lager) und unabhaengig von RLS-Konfig sind.
 */

const MAIN_LOCATION_NAMES = new Set([
  "Hofstetten",
  "Teich",
  "Rabenstein",
  "Kirchberg",
]);

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("locations")
      .select("id,name")
      .order("name");
    if (error) throw error;
    const items = (data ?? []).filter((l: { name: string }) =>
      MAIN_LOCATION_NAMES.has(l.name)
    );
    return NextResponse.json({ ok: true, locations: items });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Filialen konnten nicht geladen werden.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
