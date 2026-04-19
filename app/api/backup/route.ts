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

type TableSpec = {
  /** Sektions-Header im CSV (z.B. "SUBMITTED_ORDERS"). */
  section: string;
  /** Tabellenname in Postgres. */
  table: string;
  /** Spalte zum Sortieren der Zeilen (deterministisches Backup). */
  orderColumn: string;
  /** Fallback-Spalten, falls die Tabelle leer ist. */
  fallbackHeaders: string[];
  /** Wenn true: Fehler beim Lesen werden als Notiz geschrieben statt zu werfen. */
  optional?: boolean;
};

const BACKUP_TABLES: TableSpec[] = [
  // Stammdaten
  {
    section: "LOCATIONS",
    table: "locations",
    orderColumn: "id",
    fallbackHeaders: ["id", "name", "parent_id"],
  },
  {
    section: "PRODUCTS",
    table: "products",
    orderColumn: "id",
    fallbackHeaders: [
      "id",
      "brand",
      "product_name",
      "zusatz",
      "barcode",
      "short_name",
      "min_quantity",
    ],
  },
  // Bestand + Historie
  {
    section: "INVENTORY",
    table: "inventory",
    orderColumn: "location_id",
    fallbackHeaders: ["location_id", "product_id", "quantity"],
  },
  {
    section: "INVENTORY_HISTORY",
    table: "inventory_history",
    orderColumn: "id",
    fallbackHeaders: [
      "id",
      "user_id",
      "location_id",
      "product_id",
      "quantity",
      "timestamp",
      "is_transfer",
      "mode",
    ],
  },
  // Bestellungen
  {
    section: "SUBMITTED_ORDERS",
    table: "submitted_orders",
    orderColumn: "created_at",
    fallbackHeaders: [
      "id",
      "location_id",
      "iso_year",
      "iso_week",
      "created_at",
      "items",
      "delivered_at",
    ],
  },
  {
    section: "ORDER_REQUESTS",
    table: "order_requests",
    orderColumn: "created_at",
    fallbackHeaders: [
      "id",
      "location_id",
      "product_id",
      "quantity",
      "created_at",
      "updated_at",
      "processed_at",
    ],
  },
  {
    section: "ORDER_OVERRIDES",
    table: "order_overrides",
    orderColumn: "updated_at",
    fallbackHeaders: ["location_id", "product_id", "quantity", "updated_at"],
  },
  // KI
  {
    section: "AI_CONSUMPTION",
    table: "ai_consumption",
    orderColumn: "created_at",
    fallbackHeaders: [
      "id",
      "location_id",
      "product_id",
      "daily_consumption",
      "suggested_order_7_days",
      "is_anomaly",
      "raw_input",
      "raw_output",
      "created_at",
    ],
  },
  {
    section: "AI_CONSUMPTION_JOBS",
    table: "ai_consumption_jobs",
    orderColumn: "created_at",
    fallbackHeaders: [
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
    ],
  },
  // Audit + User-Mapping (optional: existieren nicht zwingend in jeder Umgebung)
  {
    section: "ADMIN_AUDIT_LOG",
    table: "admin_audit_log",
    orderColumn: "created_at",
    fallbackHeaders: [
      "id",
      "created_at",
      "action",
      "actor",
      "location_id",
      "payload",
      "result",
      "ok",
      "error",
    ],
    optional: true,
  },
  {
    section: "LOCATION_USERS",
    table: "location_users",
    orderColumn: "user_id",
    fallbackHeaders: ["user_id", "location_id", "role"],
    optional: true,
  },
  {
    section: "USERS",
    table: "users",
    orderColumn: "id",
    fallbackHeaders: ["id"],
    optional: true,
  },
];

function buildBackupCsv(): Promise<string> {
  return (async () => {
    const supabase = getSupabaseAdmin();
    const sections: string[] = [];

    for (const spec of BACKUP_TABLES) {
      try {
        const rows = await fetchAllRows(supabase, spec.table, "*", spec.orderColumn);
        const headers =
          rows[0] != null ? Object.keys(rows[0]) : spec.fallbackHeaders;
        sections.push(
          spec.section,
          `# rows=${rows.length}`,
          rowsToCsv(headers, rows),
          ""
        );
      } catch (e: unknown) {
        const msg = backupErrorMessage(e);
        if (spec.optional) {
          sections.push(
            spec.section,
            `# SKIPPED (${msg})`,
            rowsToCsv(spec.fallbackHeaders, []),
            ""
          );
        } else {
          throw new Error(`Backup-Fehler in Tabelle ${spec.table}: ${msg}`);
        }
      }
    }

    return sections.join("\r\n");
  })();
}

/**
 * GET-Variante f\u00fcr Vercel Cron Jobs. Vercel-Crons rufen ihre Pfade per GET
 * auf und setzen `Authorization: Bearer <CRON_SECRET>`. Damit die ge\u00fcblichen
 * UI-Calls (POST mit `adminCode`) unber\u00fchrt bleiben, kommt hier eine eigene
 * Auth-Pr\u00fcfung gegen `CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    if (!cronSecret) {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET fehlt." },
        { status: 500 }
      );
    }
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Server-Konfiguration: NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY m\u00fcssen gesetzt sein.",
        },
        { status: 500 }
      );
    }

    const csv = await buildBackupCsv();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${stamp}.csv`;

    const result: {
      ok: true;
      stamp: string;
      bytes: number;
      bucket: { ok: boolean; error?: string } | null;
      email: { ok: boolean; error?: string } | null;
    } = {
      ok: true,
      stamp,
      bytes: Buffer.byteLength(csv, "utf8"),
      bucket: null,
      email: null,
    };

    // 1) Optional: in Supabase Storage Bucket "backups" ablegen.
    //    Bucket muss einmalig manuell angelegt werden (Storage \u2192 New bucket \u2192 "backups", privat).
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.storage
        .from("backups")
        .upload(filename, Buffer.from(csv, "utf8"), {
          contentType: "text/csv; charset=utf-8",
          upsert: false,
        });
      if (error) {
        result.bucket = { ok: false, error: error.message };
      } else {
        result.bucket = { ok: true };
      }
    } catch (e: unknown) {
      result.bucket = { ok: false, error: backupErrorMessage(e) };
    }

    // 2) Optional: per Email versenden, wenn Resend konfiguriert ist.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const to = process.env.BACKUP_EMAIL ?? "sebastian.strasser@gmx.at";
        const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";
        const resend = new Resend(resendKey);
        const { error: resendErr } = await resend.emails.send({
          from,
          to: [to],
          subject: `Fridge App Backup \u00b7 ${stamp}`,
          text: `Automatisches t\u00e4gliches Backup der Fridge-App (${stamp}). Anhang: ${filename}`,
          attachments: [{ filename, content: Buffer.from(csv, "utf8") }],
        });
        result.email = resendErr
          ? { ok: false, error: resendErr.message ?? "Resend error" }
          : { ok: true };
      } catch (e: unknown) {
        result.email = { ok: false, error: backupErrorMessage(e) };
      }
    }

    if (
      (result.bucket && !result.bucket.ok) &&
      (result.email == null || !result.email.ok)
    ) {
      return NextResponse.json(
        { ...result, ok: false, error: "Weder Bucket-Upload noch Email erfolgreich." },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("[api/backup GET]", e);
    return NextResponse.json(
      { ok: false, error: backupErrorMessage(e) || "Backup failed" },
      { status: 500 }
    );
  }
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

    let body: { adminCode?: string; backupCode?: string; download?: boolean };
    try {
      body = (await request.json()) as {
        adminCode?: string;
        backupCode?: string;
        download?: boolean;
      };
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const provided = (body.backupCode ?? body.adminCode ?? "").trim();
    if (!provided || provided !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const csv = await buildBackupCsv();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${stamp}.csv`;

    // Direct-Download-Modus: CSV als Attachment zurueckgeben, keine Email.
    // Wird von der Admin-Seite genutzt, damit der Admin sofort eine lokale
    // Kopie hat ohne Email-Roundtrip.
    if (body.download === true) {
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    }

    // Email-Modus (Default fuer den UI-Button "Backup senden")
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

    const resend = new Resend(resendKey);
    const { error: resendErr } = await resend.emails.send({
      from,
      to: [to],
      subject: "Fridge App Backup",
      text: `Automatisches Backup der Fridge-App (${stamp}). Anhang: ${filename}`,
      attachments: [{ filename, content: Buffer.from(csv, "utf8") }],
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
