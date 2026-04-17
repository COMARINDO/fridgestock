import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function backupErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderColumn: string
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  let from = 0;
  const all: Record<string, unknown>[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as unknown as Record<string, unknown>[];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function buildBackupCsv(): Promise<string> {
  return (async () => {
    const supabase = getSupabaseAdmin();
    const locations = await fetchAllRows(supabase, "locations", "*", "id");
    const products = await fetchAllRows(supabase, "products", "*", "id");
    const inventory = await fetchAllRows(supabase, "inventory", "*", "location_id");
    const inventoryHistory = await fetchAllRows(
      supabase,
      "inventory_history",
      "*",
      "id"
    );
    const orderOverrides = await fetchAllRows(
      supabase,
      "order_overrides",
      "*",
      "updated_at"
    );
    const aiConsumption = await fetchAllRows(supabase, "ai_consumption", "*", "created_at");
    const aiConsumptionJobs = await fetchAllRows(
      supabase,
      "ai_consumption_jobs",
      "*",
      "created_at"
    );

    const locHeaders =
      locations[0] != null ? Object.keys(locations[0]) : ["id", "name", "parent_id"];
    const prodHeaders =
      products[0] != null
        ? Object.keys(products[0])
        : [
            "id",
            "brand",
            "product_name",
            "zusatz",
            "barcode",
            "short_name",
            "min_quantity",
          ];
    const invHeaders =
      inventory[0] != null
        ? Object.keys(inventory[0])
        : ["location_id", "product_id", "quantity"];
    const histHeaders =
      inventoryHistory[0] != null
        ? Object.keys(inventoryHistory[0])
        : ["id", "user_id", "location_id", "product_id", "quantity", "timestamp"];
    const overrideHeaders =
      orderOverrides[0] != null
        ? Object.keys(orderOverrides[0])
        : ["location_id", "product_id", "quantity", "updated_at"];
    const aiHeaders =
      aiConsumption[0] != null
        ? Object.keys(aiConsumption[0])
        : [
            "id",
            "location_id",
            "product_id",
            "daily_consumption",
            "suggested_order_7_days",
            "is_anomaly",
            "raw_input",
            "raw_output",
            "created_at",
          ];
    const aiJobHeaders =
      aiConsumptionJobs[0] != null
        ? Object.keys(aiConsumptionJobs[0])
        : [
            "id",
            "inventory_history_id",
            "location_id",
            "product_id",
            "previous_quantity",
            "current_quantity",
            "days_between",
            "status",
            "error",
            "raw_input",
            "raw_output",
            "created_at",
            "processed_at",
          ];
    return [
      "LOCATIONS",
      rowsToCsv(locHeaders, locations),
      "",
      "PRODUCTS",
      rowsToCsv(prodHeaders, products),
      "",
      "INVENTORY",
      rowsToCsv(invHeaders, inventory),
      "",
      "INVENTORY_HISTORY",
      rowsToCsv(histHeaders, inventoryHistory),
      "",
      "ORDER_OVERRIDES",
      rowsToCsv(overrideHeaders, orderOverrides),
      "",
      "AI_CONSUMPTION",
      rowsToCsv(aiHeaders, aiConsumption),
      "",
      "AI_CONSUMPTION_JOBS",
      rowsToCsv(aiJobHeaders, aiConsumptionJobs),
      "",
    ].join("\r\n");
  })();
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Server-Konfiguration: NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (z. B. in .env.local).",
        },
        { status: 500 }
      );
    }
    const expected = process.env.ADMIN_BACKUP_CODE?.trim();
    if (!expected) {
      return NextResponse.json(
        {
          ok: false,
          error: "Server-Konfiguration: ADMIN_BACKUP_CODE muss gesetzt sein.",
        },
        { status: 500 }
      );
    }

    let body: { adminCode?: string; backupCode?: string };
    try {
      body = (await request.json()) as { adminCode?: string; backupCode?: string };
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.backupCode ?? body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const to = process.env.BACKUP_EMAIL ?? "sebastian.strasser@gmx.at";
    const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";

    if (!resendKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "RESEND_API_KEY fehlt. Lokal in .env.local setzen; auf Vercel/hosting unter Environment Variables eintragen und neu deployen.",
        },
        { status: 500 }
      );
    }

    const csv = await buildBackupCsv();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

    const resend = new Resend(resendKey);
    const { error: resendErr } = await resend.emails.send({
      from,
      to: [to],
      subject: "Fridge App Backup",
      text: `Automatisches Backup der Fridge-App (${stamp}). Anhang: backup.csv`,
      attachments: [
        {
          filename: `backup-${stamp}.csv`,
          content: Buffer.from(csv, "utf8"),
        },
      ],
    });

    if (resendErr) {
      return NextResponse.json(
        { ok: false, error: resendErr.message ?? "Resend error" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[api/backup]", e);
    const message = backupErrorMessage(e) || "Backup failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
