import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function parseRowObject(data: unknown): Record<string, unknown> | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
}

/**
 * Convert a thrown value (possibly a Supabase PostgrestError) into a real
 * Error instance with a readable message. Supabase errors are plain objects
 * like { message, code, details, hint } — without this helper they fall
 * through `e instanceof Error` checks and turn into meaningless fallbacks.
 */
function toError(e: unknown, contextLabel: string): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
    if (typeof obj.details === "string" && obj.details) parts.push(obj.details);
    if (typeof obj.hint === "string" && obj.hint) parts.push(`Hinweis: ${obj.hint}`);
    if (typeof obj.code === "string" && obj.code) parts.push(`(code ${obj.code})`);
    if (parts.length > 0) return new Error(parts.join(" · "));
  }
  try {
    return new Error(`${contextLabel}: ${JSON.stringify(e)}`);
  } catch {
    return new Error(contextLabel);
  }
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
  if (error) throw toError(error, "process_open_order_requests fehlgeschlagen");
  const row = parseRowObject(data);
  return {
    processedRows: Math.max(0, Math.floor(Number(row?.processed_rows ?? 0) || 0)),
    processedAt: String(row?.processed_at ?? ""),
  };
}

export async function archiveOrderForLocationServer(args: {
  locationId: string;
  items: Array<{ product_id: string; quantity: number }>;
  closeOpenRequests?: boolean;
}): Promise<{
  orderId: string;
  itemCount: number;
  closedRequests: number;
  isoYear: number;
  isoWeek: number;
}> {
  const locationId = (args.locationId ?? "").trim();
  if (!locationId) throw new Error("location_id fehlt.");
  const items = (Array.isArray(args.items) ? args.items : [])
    .map((it) => ({
      product_id: String(it?.product_id ?? "").trim(),
      quantity: Math.max(0, Math.floor(Number(it?.quantity) || 0)),
    }))
    .filter((it) => it.product_id && it.quantity > 0);
  if (items.length === 0) throw new Error("Keine Positionen zum Archivieren.");

  const supabase = getSupabaseAdmin() as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await supabase.rpc("archive_order_for_location", {
    p_location_id: locationId,
    p_items: items,
    p_close_open_requests: Boolean(args.closeOpenRequests),
  });
  if (error) throw toError(error, "archive_order_for_location fehlgeschlagen");
  const row = parseRowObject(data) ?? {};
  return {
    orderId: String(row.order_id ?? ""),
    itemCount: Math.max(0, Math.floor(Number(row.item_count ?? items.length) || 0)),
    closedRequests: Math.max(0, Math.floor(Number(row.closed_requests ?? 0) || 0)),
    isoYear: Math.max(0, Math.floor(Number(row.iso_year ?? 0) || 0)),
    isoWeek: Math.max(0, Math.floor(Number(row.iso_week ?? 0) || 0)),
  };
}

export async function updateSubmittedOrderItemsServer(args: {
  orderId: string;
  items: Array<{ product_id: string; quantity: number }>;
}): Promise<{
  orderId: string;
  itemCount: number;
}> {
  const orderId = (args.orderId ?? "").trim();
  if (!orderId) throw new Error("order_id fehlt.");
  const items = (Array.isArray(args.items) ? args.items : [])
    .map((it) => ({
      product_id: String(it?.product_id ?? "").trim(),
      quantity: Math.max(0, Math.floor(Number(it?.quantity) || 0)),
    }))
    .filter((it) => it.product_id);

  const supabase = getSupabaseAdmin() as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await supabase.rpc("update_submitted_order_items", {
    p_order_id: orderId,
    p_items: items,
  });
  if (error) throw toError(error, "update_submitted_order_items fehlgeschlagen");
  const row = parseRowObject(data) ?? {};
  return {
    orderId: String(row.order_id ?? orderId),
    itemCount: Math.max(0, Math.floor(Number(row.item_count ?? 0) || 0)),
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
  if (error) throw toError(error, "confirm_submitted_order fehlgeschlagen");

  const row = parseRowObject(data);
  const appliedItems = Math.max(0, Math.floor(Number(row?.applied_items ?? 0) || 0));
  const deliveredAt =
    typeof row?.delivered_at === "string" && row.delivered_at
      ? row.delivered_at
      : new Date().toISOString();
  return { appliedItems, deliveredAt };
}
