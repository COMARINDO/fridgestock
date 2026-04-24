import { NextResponse } from "next/server";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { actorFromRequest, logAudit } from "@/lib/auditLog";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseDeliveryNotePdf } from "@/lib/deliveryNoteParser";

export const runtime = "nodejs";
// Parsing a PDF via OpenAI can take up to ~45 s on larger scans.
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

type SubmittedOrderItem = { product_id: string; quantity: number };

type MatchedPosition = {
  product_id: string;
  quantity: number;
  metroNr: string;
  name: string;
};

type UnmatchedPosition = {
  metroNr: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  reason: "no_metro_nr" | "product_not_found" | "not_in_order";
};

function normalizeMetroDigits(raw: unknown): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

export async function POST(request: Request) {
  const actor = actorFromRequest(request);
  let orderId = "";
  let positionsParsed = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;

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

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Ungültiger multipart-Body." },
        { status: 400 }
      );
    }

    const adminCode = String(form.get("adminCode") ?? "").trim();
    if (!adminCode || adminCode !== expected) {
      await logAudit({
        action: "orders.import_delivery_note",
        actor,
        ok: false,
        error: "Unauthorized",
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    orderId = String(form.get("orderId") ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId fehlt." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Datei fehlt." }, { status: 400 });
    }
    const mime = file.type || "application/pdf";
    if (!mime.toLowerCase().includes("pdf")) {
      return NextResponse.json(
        { ok: false, error: "Nur PDF-Dateien werden unterstützt." },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `Datei zu groß (max ${MAX_BYTES / (1024 * 1024)} MB).` },
        { status: 400 }
      );
    }

    const fileName =
      (file as File).name && typeof (file as File).name === "string"
        ? (file as File).name
        : "lieferschein.pdf";
    const buffer = Buffer.from(await file.arrayBuffer());

    // Load the submitted order (to know which products are expected) and all
    // products (for Metro-Nr -> product_id mapping).
    const supabase = getSupabaseAdmin();
    const [orderRes, productsRes] = await Promise.all([
      supabase
        .from("submitted_orders")
        .select("id,location_id,items,delivered_at")
        .eq("id", orderId)
        .limit(1)
        .maybeSingle(),
      supabase.from("products").select("id,metro_order_number"),
    ]);

    if (orderRes.error) {
      return NextResponse.json(
        { ok: false, error: `Lieferung konnte nicht geladen werden: ${orderRes.error.message}` },
        { status: 500 }
      );
    }
    if (!orderRes.data) {
      return NextResponse.json(
        { ok: false, error: "Lieferung nicht gefunden." },
        { status: 404 }
      );
    }
    if (orderRes.data.delivered_at) {
      return NextResponse.json(
        { ok: false, error: "Lieferung ist bereits gebucht." },
        { status: 409 }
      );
    }
    if (productsRes.error) {
      return NextResponse.json(
        { ok: false, error: `Produkte nicht ladbar: ${productsRes.error.message}` },
        { status: 500 }
      );
    }

    const productsByMetro = new Map<string, string>();
    for (const row of productsRes.data ?? []) {
      const metro = normalizeMetroDigits((row as { metro_order_number?: unknown }).metro_order_number);
      const pid = String((row as { id?: unknown }).id ?? "").trim();
      if (!metro || !pid) continue;
      // If duplicate Metro-Nrs exist, the first wins; we still report the conflict via warning.
      if (!productsByMetro.has(metro)) productsByMetro.set(metro, pid);
    }

    const orderItems: SubmittedOrderItem[] = Array.isArray(
      (orderRes.data as { items?: unknown }).items
    )
      ? ((orderRes.data as { items: unknown[] }).items as SubmittedOrderItem[]).map((it) => ({
          product_id: String((it as { product_id?: unknown })?.product_id ?? "").trim(),
          quantity: Math.max(
            0,
            Math.floor(Number((it as { quantity?: unknown })?.quantity) || 0)
          ),
        }))
      : [];
    const orderProductIds = new Set(orderItems.map((it) => it.product_id).filter(Boolean));

    // Run the AI parser. If it throws, translate into a 502.
    let parseResult;
    try {
      parseResult = await parseDeliveryNotePdf({
        fileBuffer: buffer,
        fileName,
        mimeType: mime,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Lieferschein konnte nicht gelesen werden.";
      await logAudit({
        action: "orders.import_delivery_note",
        actor,
        payload: { orderId, fileName, size: file.size },
        ok: false,
        error: message,
      });
      return NextResponse.json(
        { ok: false, error: `Lieferschein konnte nicht gelesen werden: ${message}` },
        { status: 502 }
      );
    }

    positionsParsed = parseResult.positions.length;

    const matched = new Map<string, MatchedPosition>();
    const unmatched: UnmatchedPosition[] = [];

    for (const pos of parseResult.positions) {
      const metroDigits = pos.metroNr ? normalizeMetroDigits(pos.metroNr) : "";
      if (!metroDigits) {
        unmatched.push({
          metroNr: pos.metroNr,
          name: pos.name,
          quantity: pos.quantity,
          unit: pos.unit,
          reason: "no_metro_nr",
        });
        continue;
      }
      const productId = productsByMetro.get(metroDigits) ?? null;
      if (!productId) {
        unmatched.push({
          metroNr: metroDigits,
          name: pos.name,
          quantity: pos.quantity,
          unit: pos.unit,
          reason: "product_not_found",
        });
        continue;
      }
      if (!orderProductIds.has(productId)) {
        unmatched.push({
          metroNr: metroDigits,
          name: pos.name,
          quantity: pos.quantity,
          unit: pos.unit,
          reason: "not_in_order",
        });
        continue;
      }
      // Aggregate multiple rows for the same product (rare but possible).
      const prev = matched.get(productId);
      if (prev) {
        prev.quantity += pos.quantity;
      } else {
        matched.set(productId, {
          product_id: productId,
          quantity: pos.quantity,
          metroNr: metroDigits,
          name: pos.name,
        });
      }
    }

    const matchedList = Array.from(matched.values());
    matchedCount = matchedList.length;
    unmatchedCount = unmatched.length;

    await logAudit({
      action: "orders.import_delivery_note",
      actor,
      payload: {
        orderId,
        fileName,
        size: file.size,
        positionsParsed,
        matchedCount,
        unmatchedCount,
        responseId: parseResult.responseId,
      },
      ok: true,
    });

    return NextResponse.json({
      ok: true,
      positionsParsed,
      matched: matchedList,
      unmatched,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Lieferschein-Import fehlgeschlagen.";
    await logAudit({
      action: "orders.import_delivery_note",
      actor,
      payload: { orderId: orderId || null, positionsParsed, matchedCount, unmatchedCount },
      ok: false,
      error: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
