import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { ADMIN_CODE } from "@/lib/adminCode";
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

async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  columns: string
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  let from = 0;
  const all: Record<string, unknown>[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
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
    const locations = await fetchAllRows(supabase, "locations", "*");
    const products = await fetchAllRows(supabase, "products", "*");
    const inventory = await fetchAllRows(supabase, "inventory", "*");
    const inventoryHistory = await fetchAllRows(supabase, "inventory_history", "*");

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
    ].join("\r\n");
  })();
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

export async function POST(request: Request) {
  try {
    let body: { adminCode?: string };
    try {
      body = (await request.json()) as { adminCode?: string };
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const expected = process.env.ADMIN_BACKUP_CODE ?? ADMIN_CODE;
    if (!body.adminCode || body.adminCode.trim() !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const to = process.env.BACKUP_EMAIL ?? "sebastian.strasser@gmx.at";
    const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";

    if (!resendKey) {
      return NextResponse.json(
        { ok: false, error: "RESEND_API_KEY is not configured" },
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
    const message = e instanceof Error ? e.message : "Backup failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
