import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { logAudit, actorFromRequest } from "@/lib/auditLog";
import { ipFromRequest, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

type Body = {
  product?: unknown;
  quantity?: unknown;
  name?: unknown;
  phone?: unknown;
  pickup_time?: unknown;
  location_id?: unknown;
  notes?: unknown;
};

function trimToLen(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

const PHONE_REGEX = /^[+0-9()\s\-/.]{4,30}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  const ip = ipFromRequest(request);

  const rl = rateLimit(`customer-order:${ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Zu viele Bestellungen. Bitte später erneut versuchen." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const product = trimToLen(body.product, 200);
  const name = trimToLen(body.name, 120);
  const phoneRaw = trimToLen(body.phone, 40);
  const pickupTime = trimToLen(body.pickup_time, 120);
  const locationId = trimToLen(body.location_id, 64);
  const notes = trimToLen(body.notes, 500) || null;

  const quantityRaw = body.quantity;
  const quantity =
    typeof quantityRaw === "number"
      ? Math.floor(quantityRaw)
      : typeof quantityRaw === "string"
        ? Number.parseInt(quantityRaw.trim(), 10)
        : NaN;

  const errors: string[] = [];
  if (!product) errors.push("Produkt fehlt.");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9999)
    errors.push("Ungültige Stückzahl.");
  if (!name) errors.push("Name fehlt.");
  if (!phoneRaw) errors.push("Telefonnummer fehlt.");
  else if (!PHONE_REGEX.test(phoneRaw)) errors.push("Telefonnummer ungültig.");
  if (!pickupTime) errors.push("Abholzeit fehlt.");
  if (!locationId || !UUID_REGEX.test(locationId)) errors.push("Filiale ungültig.");

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, error: errors.join(" ") },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: loc, error: locError } = await supabase
      .from("locations")
      .select("id,name")
      .eq("id", locationId)
      .maybeSingle();
    if (locError) throw locError;
    if (!loc) {
      return NextResponse.json(
        { ok: false, error: "Filiale unbekannt." },
        { status: 400 }
      );
    }

    const insertPayload = {
      product,
      quantity,
      name,
      phone: phoneRaw,
      pickup_time: pickupTime,
      location_id: locationId,
      notes,
      status: "open" as const,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("customer_orders")
      .insert(insertPayload)
      .select("id, created_at")
      .single();
    if (insertError) throw insertError;

    await logAudit({
      action: "customer_order.create",
      actor,
      locationId,
      payload: { product, quantity, pickupTime, location: loc.name },
      result: { id: inserted.id },
      ok: true,
    });

    return NextResponse.json({ ok: true, id: inserted.id, createdAt: inserted.created_at });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Bestellung konnte nicht gespeichert werden.";
    await logAudit({
      action: "customer_order.create",
      actor,
      locationId: locationId || null,
      payload: { product, quantity, pickupTime },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
