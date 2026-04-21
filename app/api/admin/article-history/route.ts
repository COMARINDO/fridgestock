import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";

export const runtime = "nodejs";

type LocationRow = {
  id: string;
  name: string;
  type: string | null;
  parent_id: string | null;
};

type ProductRow = {
  id: string;
  brand: string | null;
  product_name: string | null;
  zusatz: string | null;
  short_name: string | null;
};

type HistoryRow = {
  id: string;
  location_id: string;
  product_id: string;
  quantity: number;
  timestamp: string;
  is_transfer: boolean;
  mode: string | null;
};

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor: string | null;
  location_id: string | null;
  payload: unknown;
  ok: boolean;
};

type EnrichedHistory = HistoryRow & {
  prev_quantity: number | null;
  delta: number | null;
  location_name: string;
};

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

function parseDays(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, n);
}

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

  const productId = (url.searchParams.get("productId") ?? "").trim();
  const locationId = (url.searchParams.get("locationId") ?? "").trim();
  const daysRaw = (url.searchParams.get("days") ?? "").trim();
  const days = parseDays(daysRaw);

  try {
    const supabase = getSupabaseAdmin();

    // Always return the product + location catalog so the client can render filters.
    const [{ data: prodData, error: prodErr }, { data: locData, error: locErr }] =
      await Promise.all([
        supabase
          .from("products")
          .select("id,brand,product_name,zusatz,short_name")
          .order("brand", { ascending: true })
          .order("product_name", { ascending: true }),
        supabase
          .from("locations")
          .select("id,name,type,parent_id")
          .order("name", { ascending: true }),
      ]);
    if (prodErr) throw prodErr;
    if (locErr) throw locErr;

    const products = (prodData ?? []) as ProductRow[];
    const locations = (locData ?? []) as LocationRow[];

    // No product selected yet -> just return catalog.
    if (!productId) {
      return NextResponse.json({
        ok: true,
        products,
        locations,
        days,
        rows: [],
        audit: [],
        activeProductId: null,
        activeLocationId: null,
      });
    }

    // Validate product id.
    const product = products.find((p) => p.id === productId);
    if (!product) {
      return NextResponse.json(
        { ok: false, error: "Unbekanntes Produkt." },
        { status: 400 }
      );
    }

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Fetch history for this product, optionally narrowed by location.
    let query = supabase
      .from("inventory_history")
      .select("id,location_id,product_id,quantity,timestamp,is_transfer,mode")
      .eq("product_id", productId)
      .gte("timestamp", sinceIso)
      .order("timestamp", { ascending: true });
    if (locationId) query = query.eq("location_id", locationId);
    const { data: historyData, error: historyErr } = await query;
    if (historyErr) throw historyErr;
    const history = (historyData ?? []) as HistoryRow[];

    // Compute prev_quantity / delta per (location_id) from the time-ordered stream.
    // We need the row immediately BEFORE the window to have a correct first-delta,
    // unless the window was narrowed by location (we still fetch a single anchor row
    // per location to cover this).
    const locIds = Array.from(new Set(history.map((r) => r.location_id)));
    const anchors = new Map<string, { quantity: number; timestamp: string }>();
    if (locIds.length > 0) {
      // Fetch the last row before `sinceIso` for each (location, product), so we can
      // attribute a delta to the first in-window row. Do this in a single round-trip
      // using a lateral-style approach: one query per location is simplest and fine
      // given this is a single-product, small-N case.
      const anchorPromises = locIds.map((lid) =>
        supabase
          .from("inventory_history")
          .select("location_id,quantity,timestamp")
          .eq("product_id", productId)
          .eq("location_id", lid)
          .lt("timestamp", sinceIso)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle()
      );
      const anchorResults = await Promise.all(anchorPromises);
      anchorResults.forEach((res) => {
        const row = (res?.data ?? null) as {
          location_id: string;
          quantity: number;
          timestamp: string;
        } | null;
        if (row) anchors.set(row.location_id, {
          quantity: row.quantity,
          timestamp: row.timestamp,
        });
      });
    }

    const locationName = new Map<string, string>(
      locations.map((l) => [l.id, l.name])
    );

    const running = new Map<string, number>();
    locIds.forEach((lid) => {
      const anchor = anchors.get(lid);
      if (anchor) running.set(lid, anchor.quantity);
    });

    const enriched: EnrichedHistory[] = history.map((row) => {
      const prev = running.has(row.location_id)
        ? (running.get(row.location_id) as number)
        : null;
      const delta = prev == null ? null : row.quantity - prev;
      running.set(row.location_id, row.quantity);
      return {
        ...row,
        prev_quantity: prev,
        delta,
        location_name: locationName.get(row.location_id) ?? "—",
      };
    });

    // Return newest first for the UI.
    enriched.reverse();

    // Audit log entries in the same window. Filter client-side on payload/action
    // because the schema stores a free-form text `action` and a JSON payload.
    const { data: auditData, error: auditErr } = await supabase
      .from("admin_audit_log")
      .select("id,created_at,action,actor,location_id,payload,ok")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500);
    if (auditErr) throw auditErr;
    const allAudit = (auditData ?? []) as AuditRow[];

    const audit = allAudit.filter((a) => {
      const p = a.payload as Record<string, unknown> | null;
      if (!p) return false;
      // Match if payload references this product in any obvious key.
      const keys = ["product_id", "productId", "id"];
      for (const k of keys) {
        const v = p[k];
        if (typeof v === "string" && v === productId) return true;
      }
      // Nested items arrays (e.g. delivery booking).
      const items = p.items;
      if (Array.isArray(items)) {
        for (const it of items) {
          if (it && typeof it === "object") {
            const obj = it as Record<string, unknown>;
            const pid = obj.product_id ?? obj.productId ?? obj.id;
            if (typeof pid === "string" && pid === productId) return true;
          }
        }
      }
      return false;
    });

    return NextResponse.json({
      ok: true,
      products,
      locations,
      days,
      activeProductId: productId,
      activeLocationId: locationId || null,
      rows: enriched,
      audit,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Konnte Artikel-Historie nicht laden.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
