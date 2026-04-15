import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const SHORT_WINDOW_MAX_GROWTH = 1.2;

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
  avg_past_daily_consumption: number | null;
  recent_trend_label: "increasing" | "decreasing" | "stable";
  recent_trend_pct: number | null;
  is_weekend: boolean;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const basePrompt = [
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
    "- If current stock is higher than previous stock, return 0 consumption.",
    "- Ignore increases (likely restocking or correction).",
    "- Be conservative (avoid overreacting to spikes).",
    "- Daily consumption must not exceed (previous stock / days_between).",
    "- If days_between is very small (< 1), avoid extreme values.",
    "- Round values to reasonable numbers.",
    "",
    "Respond in JSON:",
    '{ "daily_consumption": number, "is_anomaly": boolean, "suggested_order_7_days": number }',
  ];

  const prompt =
    args.avg_past_daily_consumption !== null
      ? [
          ...basePrompt,
          "",
          "Historical context:",
          `- Average past daily consumption: ${args.avg_past_daily_consumption}`,
          args.recent_trend_pct !== null
            ? `- Recent trend: ${args.recent_trend_label} (${Math.round(args.recent_trend_pct * 100)}%)`
            : `- Recent trend: ${args.recent_trend_label}`,
          "",
          "Context:",
          `- Is weekend: ${args.is_weekend}`,
          "",
          "Instruction:",
          "- Use historical data to smooth the result.",
          "- Do not overreact to a single data point.",
          "- If trend is increasing, allow slightly higher consumption.",
          "- If trend is decreasing, be conservative.",
          "- On weekends, consumption may be slightly higher.",
        ]
          .filter((l): l is string => Boolean(l))
          .join("\n")
      : [
          ...basePrompt,
          "",
          "Context:",
          `- Is weekend: ${args.is_weekend}`,
          "",
          "Instruction:",
          "- On weekends, consumption may be slightly higher.",
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
} {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const daily = Number(obj.daily_consumption);
  const isAnomaly = Boolean(obj.is_anomaly);
  return {
    daily_consumption: Number.isFinite(daily) ? daily : null,
    is_anomaly: isAnomaly,
  };
}

export async function POST(req: Request) {
  try {
    requireSecret(req);

    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "25")));

    const supabase = getSupabaseAdmin();

    // Retry/lease reset: if a worker crashed after claiming a job, it can get stuck in "processing".
    // We reset stale "processing" jobs back to "pending" after 15 minutes.
    try {
      const staleIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await supabase
        .from("ai_consumption_jobs")
        .update({
          status: "pending",
          error: "stale processing lease reset",
        })
        .eq("status", "processing")
        .is("processed_at", null)
        .lt("created_at", staleIso);
    } catch {
      // ignore retry reset errors
    }

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
        // Load historical AI values (last 3) for smoothing.
        const { data: histRows } = await supabase
          .from("ai_consumption")
          .select("daily_consumption,created_at")
          .eq("location_id", job.location_id)
          .eq("product_id", job.product_id)
          .order("created_at", { ascending: false })
          .limit(3);

        const history = ((histRows ?? []) as Array<{ daily_consumption?: number | null }>)
          .map((r) => Number(r.daily_consumption))
          .filter((n) => Number.isFinite(n) && n >= 0);

        const avg =
          history.length > 0 ? history.reduce((a, b) => a + b, 0) / history.length : null;

        const trend =
          history.length >= 2 && (history[1] ?? 0) !== 0
            ? ((history[0] ?? 0) - (history[1] ?? 0)) / (history[1] ?? 1)
            : null;

        let trendLabel: "increasing" | "decreasing" | "stable" = "stable";
        if (trend !== null) {
          if (trend > 0.1) trendLabel = "increasing";
          else if (trend < -0.1) trendLabel = "decreasing";
        }

        const now = new Date();
        const day = now.getDay(); // 0=Sun, 6=Sat
        const isWeekend = day === 0 || day === 6;

        const { raw, parsed } = await callOpenAI({
          previous_quantity: job.previous_quantity,
          current_quantity: job.current_quantity,
          days_between: job.days_between,
          avg_past_daily_consumption: avg,
          recent_trend_label: trendLabel,
          recent_trend_pct: trend,
          is_weekend: isWeekend,
        });
        const r = toResult(parsed);

        // If AI returned nothing useful, mark as skipped (keep job output for debugging)
        if (r.daily_consumption === null) {
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

        // If anomaly: do not learn/store as ai_consumption. Keep output on the job for debugging.
        if (r.is_anomaly) {
          skipped++;
          await supabase
            .from("ai_consumption_jobs")
            .update({
              status: "skipped",
              raw_output: raw as unknown,
              error: "anomaly",
              processed_at: new Date().toISOString(),
            })
            .eq("id", job.id);
          continue;
        }

        // Smooth result with historical average (70/30). Also clamp to safe bounds.
        const aiValue = Math.max(0, Number(r.daily_consumption));
        const smoothed = avg !== null ? avg * 0.7 + aiValue * 0.3 : aiValue;
        const days = Number(job.days_between);
        const safeDays = Number.isFinite(days) && days > 0 ? Math.max(days, 1) : 1;
        const maxDaily = Math.max(0, Number(job.previous_quantity) / safeDays);
        let finalValue = Math.min(smoothed, maxDaily);
        if (days < 1 && avg !== null) {
          const maxAllowed = avg * SHORT_WINDOW_MAX_GROWTH; // max +20% growth on very small windows
          finalValue = Math.min(finalValue, maxAllowed);
        }
        if (isWeekend) {
          finalValue = finalValue * 1.05; // +5% on weekends
        }
        // Final clamp (keep system safe)
        finalValue = Math.min(finalValue, maxDaily);
        const finalRounded = Math.round(finalValue * 100) / 100; // reasonable rounding
        const suggested7 = Math.max(0, Math.round(finalRounded * 7));

        await supabase.from("ai_consumption").insert({
          location_id: job.location_id,
          product_id: job.product_id,
          daily_consumption: finalRounded,
          suggested_order_7_days: suggested7,
          is_anomaly: false,
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

