import { NextResponse } from "next/server";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  HOFSTETTEN_NAME,
  KIRCHBERG_NAME,
  RABENSTEIN_LAGER_NAME,
} from "@/lib/locationConstants";

export const runtime = "nodejs";

const ALLOWED_NAMES = new Set(
  [RABENSTEIN_LAGER_NAME, HOFSTETTEN_NAME, KIRCHBERG_NAME].map((s) => s.trim().toLowerCase())
);

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  let locationId = "";
  let itemCount = 0;

  try {
    const expected = getServerActionSecret();
    if (!expected) {
      return NextResponse.json(
        {
          ok: false,
          error: "Server-Konfiguration: SERVER_ACTION_SECRET muss gesetzt sein.",
        },
        { status: 500 }
      );
    }

    let body: {
      adminCode?: string;
      locationId?: string;
      items?: Array<{ product_id?: string; quantity?: number }>;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      await logAudit({
        action: "inventory.book_delivery_note",
        actor,
        ok: false,
        error: "Unauthorized",
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    locationId = String(body.locationId ?? "").trim();
    if (!locationId) {
      return NextResponse.json({ ok: false, error: "locationId fehlt." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: locRow, error: locErr } = await supabase
      .from("locations")
      .select("id,name")
      .eq("id", locationId)
      .maybeSingle();

    if (locErr) {
      return NextResponse.json(
        { ok: false, error: `Ort nicht ladbar: ${locErr.message}` },
        { status: 500 }
      );
    }
    if (!locRow) {
      return NextResponse.json({ ok: false, error: "Ort nicht gefunden." }, { status: 404 });
    }
    const locName = String((locRow as { name?: unknown }).name ?? "").trim();
    if (!ALLOWED_NAMES.has(locName.toLowerCase())) {
      return NextResponse.json(
        {
          ok: false,
          error: `Wareneingang ist nur für „${RABENSTEIN_LAGER_NAME}", „${HOFSTETTEN_NAME}" oder „${KIRCHBERG_NAME}" erlaubt.`,
        },
        { status: 400 }
      );
    }

    const items = Array.isArray(body.items)
      ? body.items.map((it) => ({
          product_id: String(it?.product_id ?? "").trim(),
          quantity: Math.max(0, Math.floor(Number(it?.quantity) || 0)),
        }))
      : [];
    itemCount = items.length;
    const toApply = items.filter((it) => it.product_id && it.quantity > 0);
    if (toApply.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Keine Positionen mit Menge > 0." },
        { status: 400 }
      );
    }

    let applied = 0;
    for (const it of toApply) {
      const { data, error } = await supabase.rpc("apply_inventory_delta", {
        p_user_id: null,
        p_location_id: locationId,
        p_product_id: it.product_id,
        p_delta: it.quantity,
      });
      if (error) {
        throw new Error(
          `${error.message ?? "apply_inventory_delta"} (Produkt ${it.product_id})`
        );
      }
      // RPC returns integer; treat any non-throw as success
      void data;
      applied += 1;
    }

    await logAudit({
      action: "inventory.book_delivery_note",
      actor,
      payload: {
        locationId,
        locationName: locName,
        lineCount: toApply.length,
        totalPieces: toApply.reduce((s, it) => s + it.quantity, 0),
      },
      result: { applied },
      ok: true,
    });

    return NextResponse.json({ ok: true, applied, locationName: locName });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Buchung fehlgeschlagen.";
    await logAudit({
      action: "inventory.book_delivery_note",
      actor,
      payload: { locationId: locationId || null, itemCount },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
