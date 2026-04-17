import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function parseRowObject(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
}

export async function processOpenOrderRequestsServer(): Promise<{
  processedRows: number;
  processedAt: string;
}> {
  const supabase = getSupabaseAdmin() as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await supabase.rpc("process_open_order_requests", {});
  if (error) throw error;
  const row = parseRowObject(data);
  return {
    processedRows: Math.max(0, Math.floor(Number(row?.processed_rows ?? 0) || 0)),
    processedAt: String(row?.processed_at ?? ""),
  };
}

export async function confirmSubmittedOrderDeliveryServer(id: string): Promise<{
  appliedItems: number;
  deliveredAt: string;
}> {
  const oid = id.trim();
  if (!oid) throw new Error("Bestellung-ID fehlt.");

  const supabase = getSupabaseAdmin() as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await supabase.rpc("confirm_submitted_order", {
    p_order_id: oid,
  });
  if (error) throw error;

  const row = parseRowObject(data);
  const appliedItems = Math.max(0, Math.floor(Number(row?.applied_items ?? 0) || 0));
  const deliveredAt =
    typeof row?.delivered_at === "string" && row.delivered_at
      ? row.delivered_at
      : new Date().toISOString();
  return { appliedItems, deliveredAt };
}
