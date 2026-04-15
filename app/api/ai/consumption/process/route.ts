import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type JobRow = {
  id: string;
  inventory_history_id: string;
  location_id: string;
  product_id: string;
  previous_quantity: number;
  current_quantity: number;
  days_between: number;
  raw_input: unknown;
};

function requireSecret(req: Request) {
  const want = process.env.AI_CONSUMPTION_CRON_SECRET;
  if (!want) throw new Error("Missing AI_CONSUMPTION_CRON_SECRET env var.");
  const got = req.headers.get("x-ai-cron-secret") ?? "";
  if (got !== want) throw new Error("Unauthorized");
}

async function callOpenAI(args: {
  previous_quantity: number;
  current_quantity: number;
  days_between: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const prompt = [
    "You are analyzing inventory consumption.",
    "",
    "Data:",
    `- Previous stock: ${args.previous_quantity}`,
    `- Current stock: ${args.current_quantity}`,
    `- Days between counts: ${args.days_between}`,
    "",
    "Tasks:",
    "1. Estimate the average daily consumption.",
    "2. Detect if the change might be an error (unrealistic jump).",
    "3. Suggest a stable daily consumption value (smooth, not too reactive).",
    "4. Suggest how many units should be ordered for the next 7 days.",
    "",
    "Rules:",
    "- Only negative differences count as consumption.",
    "- Ignore increases (likely restocking or correction).",
    "- Be conservative (avoid overreacting to spikes).",
    "",
    "Respond in JSON:",
    '{ "daily_consumption": number, "is_anomaly": boolean, "suggested_order_7_days": number }',
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${text}`.slice(0, 500));
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("OpenAI returned empty content.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI returned non-JSON content.");
  }
  return { raw: data as unknown, parsed };
}

function toResult(parsed: unknown): {
  daily_consumption: number | null;
  is_anomaly: boolean;
  suggested_order_7_days: number | null;
} {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const daily = Number(obj.daily_consumption);
  const suggested = Number(obj.suggested_order_7_days);
  const isAnomaly = Boolean(obj.is_anomaly);
  return {
    daily_consumption: Number.isFinite(daily) ? daily : null,
    is_anomaly: isAnomaly,
    suggested_order_7_days: Number.isFinite(suggested) ? Math.max(0, Math.round(suggested)) : null,
  };
}

export async function POST(req: Request) {
  try {
    requireSecret(req);

    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "25")));

    const supabase = getSupabaseAdmin();
    const { data: jobs, error } = await supabase
      .from("ai_consumption_jobs")
      .select(
        "id,inventory_history_id,location_id,product_id,previous_quantity,current_quantity,days_between,raw_input"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;
    const rows = (jobs ?? []) as JobRow[];

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of rows) {
      // Best-effort lock: claim the row
      const { data: claimed, error: claimErr } = await supabase
        .from("ai_consumption_jobs")
        .update({ status: "processing" })
        .eq("id", job.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (claimErr) {
        failed++;
        continue;
      }
      if (!claimed) continue; // already processed by another runner

      try {
        const { raw, parsed } = await callOpenAI({
          previous_quantity: job.previous_quantity,
          current_quantity: job.current_quantity,
          days_between: job.days_between,
        });
        const r = toResult(parsed);

        // If AI returned nothing useful, mark as skipped (keep job output for debugging)
        if (r.daily_consumption === null || r.suggested_order_7_days === null) {
          skipped++;
          await supabase
            .from("ai_consumption_jobs")
            .update({
              status: "skipped",
              raw_output: raw as unknown,
              processed_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          continue;
        }

        await supabase.from("ai_consumption").insert({
          location_id: job.location_id,
          product_id: job.product_id,
          daily_consumption: r.daily_consumption,
          suggested_order_7_days: r.suggested_order_7_days,
          is_anomaly: r.is_anomaly,
          raw_input: job.raw_input as unknown,
          raw_output: raw as unknown,
        });

        await supabase
          .from("ai_consumption_jobs")
          .update({
            status: "done",
            raw_output: raw as unknown,
            processed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        processed++;
      } catch (e: unknown) {
        failed++;
        await supabase
          .from("ai_consumption_jobs")
          .update({
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
            processed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      }
    }

    return Response.json({ ok: true, pending: rows.length, processed, failed, skipped });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}

