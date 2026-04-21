import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerActionSecret } from "@/lib/serverActionSecret";
import { RABENSTEIN_LAGER_NAME } from "@/lib/locationConstants";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set(["all", "open", "booked", "ignored"]);

type ShrinkageRow = {
  product_id: string;
  brand: string;
  product_name: string;
  zusatz: string;
  short_name: string;
  expected_quantity: number;
  counted_quantity: number;
  shrink_quantity: number;
  count_at: string;
  prev_event_at: string | null;
  prev_event_mode: string | null;
};

type PersistedRow = {
  id: string;
  location_id: string;
  product_id: string;
  session_no: number;
  session_started_at: string | null;
  prev_event_at: string | null;
  prev_event_mode: string | null;
  count_at: string;
  expected_quantity: number;
  counted_quantity: number;
  shrink_quantity: number;
  status: "open" | "booked" | "ignored";
  booked_at: string | null;
  booked_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

async function listWarehouseLocations(): Promise<
  Array<{ id: string; name: string }>
> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("locations")
    .select("id,name")
    .is("parent_id", null);
  if (error) throw error;
  return (data ?? [])
    .filter((l: { name: string }) => l.name === RABENSTEIN_LAGER_NAME)
    .map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }));
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

  const locationId = (url.searchParams.get("locationId") ?? "").trim();
  const sessionNoRaw = (url.searchParams.get("sessionNo") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "all").trim();
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const warehouses = await listWarehouseLocations();
    if (warehouses.length === 0) {
      return NextResponse.json({
        ok: true,
        locations: [],
        sessions: [],
        rows: [],
      });
    }

    const effectiveLocationId = locationId || warehouses[0].id;
    if (!warehouses.some((w) => w.id === effectiveLocationId)) {
      return NextResponse.json(
        { ok: false, error: "Schwund wird nur fuer das Lager unterstuetzt." },
        { status: 400 }
      );
    }

    const { data: sessionsData, error: sessErr } = await supabase.rpc(
      "inventory_count_sessions",
      { p_location_id: effectiveLocationId }
    );
    if (sessErr) throw sessErr;
    const sessions = (Array.isArray(sessionsData) ? sessionsData : []) as Array<{
      session_no: number;
      started_at: string;
      ended_at: string;
      count_rows: number;
      distinct_products: number;
    }>;

    if (sessions.length === 0) {
      return NextResponse.json({
        ok: true,
        locations: warehouses,
        sessions: [],
        rows: [],
      });
    }

    const targetSessionNo = Number.isFinite(Number(sessionNoRaw))
      ? Number(sessionNoRaw)
      : sessions[0]?.session_no;
    const targetSession = sessions.find((s) => s.session_no === targetSessionNo) ?? sessions[0];

    // 1) Compute live shrinkage candidates from SQL helper.
    const { data: calcData, error: calcErr } = await supabase.rpc(
      "inventory_shrinkage_for_session",
      {
        p_location_id: effectiveLocationId,
        p_session_no: targetSession.session_no,
      }
    );
    if (calcErr) throw calcErr;
    const calculated = (Array.isArray(calcData) ? calcData : []) as ShrinkageRow[];

    // 2) Upsert "open" rows for new discrepancies so they can be booked/ignored.
    //    We only create new rows; we never overwrite booked/ignored status.
    if (calculated.length > 0) {
      const payload = calculated.map((r) => ({
        location_id: effectiveLocationId,
        product_id: r.product_id,
        session_no: targetSession.session_no,
        session_started_at: targetSession.started_at,
        prev_event_at: r.prev_event_at,
        prev_event_mode: r.prev_event_mode,
        count_at: r.count_at,
        expected_quantity: r.expected_quantity,
        counted_quantity: r.counted_quantity,
        shrink_quantity: r.shrink_quantity,
        status: "open" as const,
      }));
      // ON CONFLICT (location_id, product_id, count_at) DO NOTHING -> keeps existing status.
      const { error: upErr } = await supabase
        .from("inventory_discrepancies")
        .upsert(payload, {
          onConflict: "location_id,product_id,count_at",
          ignoreDuplicates: true,
        });
      if (upErr) throw upErr;
    }

    // 3) Load persisted rows for the session (incl. booked/ignored).
    let query = supabase
      .from("inventory_discrepancies")
      .select(
        "id, location_id, product_id, session_no, session_started_at, prev_event_at, prev_event_mode, count_at, expected_quantity, counted_quantity, shrink_quantity, status, booked_at, booked_by, note, created_at, updated_at"
      )
      .eq("location_id", effectiveLocationId)
      .eq("session_no", targetSession.session_no)
      .order("created_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    const { data: persisted, error: persistErr } = await query;
    if (persistErr) throw persistErr;
    const persistedRows = (persisted ?? []) as PersistedRow[];

    // 4) Enrich with product info (brand/name/zusatz/short_name).
    const productIds = Array.from(new Set(persistedRows.map((r) => r.product_id)));
    let productMap = new Map<
      string,
      { brand: string; product_name: string; zusatz: string; short_name: string }
    >();
    if (productIds.length > 0) {
      const { data: prods, error: prodErr } = await supabase
        .from("products")
        .select("id,brand,product_name,zusatz,short_name")
        .in("id", productIds);
      if (prodErr) throw prodErr;
      productMap = new Map(
        (prods ?? []).map(
          (p: {
            id: string;
            brand: string | null;
            product_name: string | null;
            zusatz: string | null;
            short_name: string | null;
          }) => [
            p.id,
            {
              brand: p.brand ?? "",
              product_name: p.product_name ?? "",
              zusatz: p.zusatz ?? "",
              short_name: p.short_name ?? "",
            },
          ]
        )
      );
    }

    const rows = persistedRows.map((r) => {
      const info =
        productMap.get(r.product_id) ?? {
          brand: "",
          product_name: "",
          zusatz: "",
          short_name: "",
        };
      return { ...r, ...info };
    });

    return NextResponse.json({
      ok: true,
      locations: warehouses,
      sessions,
      activeLocationId: effectiveLocationId,
      activeSessionNo: targetSession.session_no,
      rows,
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Konnte Schwund-Daten nicht laden.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
