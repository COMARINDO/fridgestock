import { getSupabase } from "@/lib/supabase";
import type {
  InventoryHistoryRow,
  InventoryRow,
  Location,
  OrderOverrideRow,
  Product,
} from "@/lib/types";

type SupabaseLikeError = { status?: number; message?: string };
function getStatus(e: unknown): number | null {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as SupabaseLikeError).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = PromiseLike<QueryResult> & {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean }
  ) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<QueryResult>;
  insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>;
};

function from(table: string): QueryBuilder {
  const supabase = getSupabase() as unknown as { from: (t: string) => unknown };
  return supabase.from(table) as QueryBuilder;
}

// NOTE: No user accounts / auth backend. Login is location-based only.

const MAIN_LOCATION_NAMES = new Set(["Teich", "Hofstetten", "Rabenstein", "Kirchberg"]);

export async function listLocations(): Promise<Location[]> {
  const { data, error } = await from("locations")
    .select("id,name,parent_id")
    .order("name");
  if (error) throw error;
  // App uses only the 4 main Platzerl. Hide legacy sub-locations (Lager/Kühlschrank).
  return ((data ?? []) as Location[]).filter((l) => MAIN_LOCATION_NAMES.has(l.name));
}

export async function getLocation(id: string): Promise<Location | null> {
  const { data, error } = await from("locations")
    .select("id,name,parent_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Location | null;
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await from("products")
    .select(
      "id,brand,product_name,zusatz,barcode,short_name,min_quantity,supplier,purchase_price,selling_price"
    )
    .order("brand");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  const code = barcode.trim();
  if (!code) return null;
  const { data, error } = await from("products")
    .select(
      "id,brand,product_name,zusatz,barcode,short_name,min_quantity,supplier,purchase_price,selling_price"
    )
    .eq("barcode", code)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Product | null;
}

export async function getInventoryForLocation(
  locationId: string
): Promise<InventoryRow[]> {
  const { data, error } = await from("inventory")
    .select("location_id,product_id,quantity")
    .eq("location_id", locationId);
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

export async function listInventoryAll(): Promise<InventoryRow[]> {
  const { data, error } = await from("inventory").select(
    "location_id,product_id,quantity"
  );
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

export type ProductWithQuantity = Product & { quantity: number };

export async function listProductsWithInventoryForLocation(
  locationId: string
): Promise<ProductWithQuantity[]> {
  const loc = locationId.trim();
  if (!loc) return [];

  // Preferred: products as base table + left join inventory.
  // Note: Some PostgREST setups may treat filters on the joined table as inner joins.
  // We'll fall back to a 2-query merge if needed to guarantee "all products" behavior.
  try {
    const supabase = getSupabase() as unknown as {
      from: (t: string) => {
        select: (columns: string) => {
          eq: (column: string, value: unknown) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };

    const { data, error } = await supabase
      .from("products")
      .select(
        "id,brand,product_name,zusatz,barcode,short_name,min_quantity,supplier,purchase_price,selling_price,inventory:inventory!left(quantity,location_id)"
      )
      .eq("inventory.location_id", loc);

    if (!error && Array.isArray(data)) {
      const rows = data as Array<
        Product & {
          inventory?: Array<{ quantity?: number | null; location_id?: string | null }>;
        }
      >;

      // If join filter caused an unintended inner join (missing products), fall back.
      if (rows.length > 0) {
        return rows.map((p) => ({
          id: p.id,
          brand: p.brand ?? null,
          product_name: p.product_name ?? null,
          zusatz: p.zusatz ?? null,
          barcode: p.barcode ?? null,
          short_name: p.short_name ?? null,
          min_quantity: (p as unknown as { min_quantity?: number | null }).min_quantity ?? 0,
          supplier: (p as unknown as { supplier?: string | null }).supplier ?? null,
          purchase_price:
            (p as unknown as { purchase_price?: number | null }).purchase_price ?? null,
          selling_price:
            (p as unknown as { selling_price?: number | null }).selling_price ?? null,
          quantity:
            Array.isArray(p.inventory) && p.inventory.length > 0
              ? Number(p.inventory[0]?.quantity ?? 0)
              : 0,
        }));
      }
    }
  } catch {
    // ignore and fall back
  }

  // Fallback: 2-query merge (guarantees all products).
  const [prods, inv] = await Promise.all([
    listProducts(),
    getInventoryForLocation(loc),
  ]);

  const m = new Map<string, number>();
  for (const row of inv) m.set(row.product_id, row.quantity);

  return prods.map((p) => ({
    ...p,
    quantity: m.get(p.id) ?? 0,
  }));
}

export async function getGlobalOverviewByProduct(): Promise<ProductWithQuantity[]> {
  const totals = new Map<string, number>();
  const [products, inv] = await Promise.all([listProducts(), listInventoryAll()]);
  for (const row of inv) {
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + (row.quantity ?? 0));
  }

  return products.map((p) => ({
    ...p,
    quantity: totals.get(p.id) ?? 0,
  }));
}

export async function getInventoryHistoryForLocation(
  locationId: string,
  limit = 200
): Promise<InventoryHistoryRow[]> {
  const { data, error } = await from("inventory_history")
    .select("id,user_id,location_id,product_id,quantity,timestamp")
    .eq("location_id", locationId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as InventoryHistoryRow[];
}

/** Latest snapshots for one product at a location (newest first). */
export async function getInventoryHistoryForProduct(
  locationId: string,
  productId: string,
  limit = 5
): Promise<InventoryHistoryRow[]> {
  const { data, error } = await from("inventory_history")
    .select("id,user_id,location_id,product_id,quantity,timestamp")
    .eq("location_id", locationId)
    .eq("product_id", productId)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as InventoryHistoryRow[];
}

/**
 * Removes one history row and syncs `inventory` to the latest remaining snapshot (or 0).
 */
export async function deleteInventoryHistoryEntry(args: {
  id: string;
  locationId: string;
  productId: string;
}): Promise<{ newQuantity: number }> {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (c: string, v: unknown) => {
          eq: (c2: string, v2: unknown) => {
            eq: (c3: string, v3: unknown) => Promise<{ error: unknown }>;
          };
        };
      };
      select: (cols: string) => {
        eq: (c: string, v: unknown) => {
          eq: (c2: string, v2: unknown) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
      upsert: (
        values: Record<string, unknown>,
        options: Record<string, unknown>
      ) => Promise<{ error: unknown }>;
    };
  };

  const { error: delErr } = await supabase
    .from("inventory_history")
    .delete()
    .eq("id", args.id)
    .eq("location_id", args.locationId)
    .eq("product_id", args.productId);
  if (delErr) throw delErr;

  const { data: latestRows, error: qErr } = await supabase
    .from("inventory_history")
    .select("quantity")
    .eq("location_id", args.locationId)
    .eq("product_id", args.productId)
    .order("timestamp", { ascending: false })
    .limit(1);
  if (qErr) throw qErr;

  const row = (latestRows ?? []) as Array<{ quantity: number }>;
  const newQuantity =
    row.length > 0 ? Math.max(0, Math.floor(Number(row[0].quantity) || 0)) : 0;

  const { error: upErr } = await supabase.from("inventory").upsert(
    {
      location_id: args.locationId,
      product_id: args.productId,
      quantity: newQuantity,
    },
    { onConflict: "location_id,product_id" }
  );
  if (upErr) throw upErr;

  return { newQuantity };
}

export async function setInventoryQuantity(args: {
  locationId: string;
  productId: string;
  quantity: number;
}) {
  // Snapshot system (2 calls):
  // 1) upsert inventory (overwrite quantity)
  // 2) insert inventory_history (append snapshot)
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      upsert: (
        values: Record<string, unknown>,
        options: Record<string, unknown>
      ) => Promise<{ error: unknown }>;
      insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
  };

  const { error: upsertErr } = await supabase.from("inventory").upsert(
    {
      location_id: args.locationId,
      product_id: args.productId,
      quantity: args.quantity,
    },
    { onConflict: "location_id,product_id" }
  );
  if (upsertErr) throw upsertErr;

  const { error: histErr } = await supabase.from("inventory_history").insert({
    user_id: null,
    location_id: args.locationId,
    product_id: args.productId,
    quantity: args.quantity,
  });
  if (histErr) {
    const status = getStatus(histErr);
    if (status === 404) {
      throw new Error(
        "Supabase API findet 'inventory_history' nicht (404). Bitte in Supabase den Schema-Cache reloaden (SQL: notify pgrst, 'reload schema';) und prüfen, dass die Tabelle im 'public' Schema liegt und über die API exposed ist."
      );
    }
    throw histErr;
  }

  await deleteOrderOverridesForLocation(args.locationId);
}

async function getInventoryQuantityForProductAtLocation(
  locationId: string,
  productId: string
): Promise<number> {
  const { data, error } = await from("inventory")
    .select("quantity")
    .eq("location_id", locationId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return Math.max(
    0,
    Math.floor(Number((data as { quantity?: number } | null)?.quantity ?? 0))
  );
}

/**
 * Atomarer Lagertransfer (RPC): zwei inventory-Updates, zwei history-Zeilen, Overrides für beide Orte löschen.
 * `void` RPCs liefern bei Erfolg oft `data: null` — das ist kein Fehler; nur `error` zählt.
 * Liefert die SQL-Funktion Zeilen (`new_from_quantity` / `new_to_quantity`), werden diese bevorzugt.
 */
export async function transferStock(args: {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
}): Promise<{ newFromQuantity: number; newToQuantity: number }> {
  const q = Math.floor(Number(args.quantity) || 0);
  if (q <= 0) throw new Error("Menge muss größer als 0 sein.");

  const [beforeFrom, beforeTo] = await Promise.all([
    getInventoryQuantityForProductAtLocation(args.fromLocationId, args.productId),
    getInventoryQuantityForProductAtLocation(args.toLocationId, args.productId),
  ]);

  const supabase = getSupabase() as unknown as {
    rpc: (
      fn: string,
      rpcArgs: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
  };

  const { data, error } = await supabase.rpc("transfer_stock", {
    p_from_location_id: args.fromLocationId,
    p_product_id: args.productId,
    p_quantity: q,
    p_to_location_id: args.toLocationId,
  });

  console.log("transfer_stock result:", { data, error });

  if (error) {
    console.error("transfer_stock error:", error);
    throw error;
  }

  // Erfolg: `data` darf null/leer sein (void). Niemals an `!data` scheitern.
  if (data != null) {
    const rows = data as unknown;
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      const nf = row.new_from_quantity ?? row.newFromQuantity;
      const nt = row.new_to_quantity ?? row.newToQuantity;
      if (
        nf !== undefined &&
        nf !== null &&
        nt !== undefined &&
        nt !== null &&
        Number.isFinite(Number(nf)) &&
        Number.isFinite(Number(nt))
      ) {
        return {
          newFromQuantity: Number(nf),
          newToQuantity: Number(nt),
        };
      }
    }
  }

  try {
    const [newFromQuantity, newToQuantity] = await Promise.all([
      getInventoryQuantityForProductAtLocation(args.fromLocationId, args.productId),
      getInventoryQuantityForProductAtLocation(args.toLocationId, args.productId),
    ]);
    return { newFromQuantity, newToQuantity };
  } catch (refetchErr) {
    console.error(
      "transfer_stock: Nachlese fehlgeschlagen, verwende erwartete Mengen (RPC war erfolgreich)",
      refetchErr
    );
    return {
      newFromQuantity: Math.max(0, beforeFrom - q),
      newToQuantity: Math.max(0, beforeTo + q),
    };
  }
}

/** Entfernt alle manuellen Bestell-Overrides für ein Platzerl (nach neuem Zähl-Snapshot). */
export async function deleteOrderOverridesForLocation(locationId: string): Promise<void> {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (c: string, v: unknown) => Promise<{ error: unknown }>;
      };
    };
  };
  const { error } = await supabase.from("order_overrides").delete().eq("location_id", locationId);
  if (error) throw error;
}

export async function listOrderOverrides(): Promise<OrderOverrideRow[]> {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      select: (columns: string) => {
        limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
  const { data, error } = await supabase
    .from("order_overrides")
    .select("location_id,product_id,quantity,updated_at")
    .limit(50000);
  if (error) throw error;
  return (data ?? []) as OrderOverrideRow[];
}

export async function upsertOrderOverride(args: {
  locationId: string;
  productId: string;
  quantity: number;
}): Promise<void> {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      upsert: (
        values: Record<string, unknown>,
        options: Record<string, unknown>
      ) => Promise<{ error: unknown }>;
    };
  };
  const q = Math.max(0, Math.floor(Number(args.quantity) || 0));
  const { error } = await supabase.from("order_overrides").upsert(
    {
      location_id: args.locationId,
      product_id: args.productId,
      quantity: q,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id,product_id" }
  );
  if (error) throw error;
}

/**
 * Neuester Snapshot aus inventory_history pro Produkt (Sortierung: Zeit absteigend).
 */
export async function getLatestInventorySnapshotsForLocation(
  locationId: string
): Promise<Record<string, { quantity: number; timestamp: string }>> {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      select: (columns: string) => {
        eq: (column: string, value: unknown) => {
          order: (
            column: string,
            options: { ascending: boolean }
          ) => {
            limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
  };
  const { data, error } = await supabase
    .from("inventory_history")
    .select("product_id,quantity,timestamp")
    .eq("location_id", locationId)
    .order("timestamp", { ascending: false })
    .limit(15000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    product_id: string;
    quantity: number;
    timestamp: string;
  }>;
  const out: Record<string, { quantity: number; timestamp: string }> = {};
  for (const row of rows) {
    if (!out[row.product_id]) {
      out[row.product_id] = {
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
        timestamp: row.timestamp,
      };
    }
  }
  return out;
}

export async function createProductWithBarcode(args: {
  brand?: string | null;
  product_name?: string | null;
  zusatz?: string | null;
  barcode: string;
  short_name?: string | null;
  min_quantity?: number | null;
}) {
  if (!args.brand?.trim()) throw new Error("Brand fehlt.");
  if (!args.product_name?.trim()) throw new Error("Produkt fehlt.");
  const { error } = await from("products").insert({
    brand: args.brand ?? "",
    product_name: args.product_name ?? "",
    zusatz: args.zusatz ?? null,
    barcode: args.barcode,
    short_name: args.short_name ?? null,
    min_quantity: args.min_quantity ?? 0,
  });
  if (error) throw error;
}

export async function updateProductBarcode(args: {
  productId: string;
  barcode: string;
  short_name: string;
}) {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (c: string, v: unknown) => Promise<{ error: unknown }>;
      };
    };
  };

  const { error } = await supabase
    .from("products")
    .update({ barcode: args.barcode, short_name: args.short_name })
    .eq("id", args.productId);
  if (error) throw error;
}

export async function updateProduct(args: {
  productId: string;
  brand: string;
  product_name: string;
  zusatz: string | null;
  barcode: string | null;
  short_name: string | null;
  min_quantity?: number | null;
}) {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (c: string, v: unknown) => Promise<{ error: unknown }>;
      };
    };
  };

  const { error } = await supabase
    .from("products")
    .update({
      brand: args.brand.trim(),
      product_name: args.product_name.trim(),
      zusatz: args.zusatz,
      barcode: args.barcode,
      short_name: args.short_name,
      ...(args.min_quantity !== undefined ? { min_quantity: args.min_quantity } : {}),
    })
    .eq("id", args.productId);
  if (error) throw error;
}

export async function updateProductPricing(args: {
  productId: string;
  supplier: string | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
}) {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (c: string, v: unknown) => Promise<{ error: unknown }>;
      };
    };
  };

  const { error } = await supabase
    .from("products")
    .update({
      supplier: args.supplier?.trim() ? args.supplier.trim() : null,
      purchase_price:
        args.purchasePrice === null || args.purchasePrice === undefined
          ? null
          : args.purchasePrice,
      selling_price:
        args.sellingPrice === null || args.sellingPrice === undefined
          ? null
          : args.sellingPrice,
    })
    .eq("id", args.productId);
  if (error) throw error;
}

export async function getLastUpdateByLocation(locationId: string): Promise<
  Record<string, string>
> {
  const loc = locationId.trim();
  if (!loc) return {};

  // Best-effort simple query: get recent history and keep first per product.
  const { data, error } = await from("inventory_history")
    .select("product_id,timestamp")
    .eq("location_id", loc)
    .order("timestamp", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ product_id: string; timestamp: string }>) {
    if (!out[row.product_id]) out[row.product_id] = row.timestamp;
  }
  return out;
}

export async function getProductStockByLocation(productId: string): Promise<
  Array<{ location_id: string; location_name: string; quantity: number }>
> {
  const pid = productId.trim();
  if (!pid) return [];

  const [inv, locs] = await Promise.all([
    (async () => {
      const { data, error } = await from("inventory")
        .select("location_id,product_id,quantity")
        .eq("product_id", pid);
      if (error) throw error;
      return (data ?? []) as InventoryRow[];
    })(),
    listLocations(),
  ]);

  const nameById = new Map(locs.map((l) => [l.id, l.name]));

  return inv
    .map((r) => ({
      location_id: r.location_id,
      location_name: nameById.get(r.location_id) ?? r.location_id,
      quantity: r.quantity ?? 0,
    }))
    .sort((a, b) => a.location_name.localeCompare(b.location_name));
}

export async function getWeeklyUsageByProduct(args?: {
  days?: number;
  multiplier?: number;
}): Promise<Record<string, number>> {
  const days = args?.days ?? 7;
  const multiplier = args?.multiplier ?? 1;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Preferred: SQL window function (lag) via RPC.
  try {
    const supabase = getSupabase() as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await supabase.rpc("usage_by_location_product_since", {
      p_since: sinceIso,
    });
    if (error) throw error;
    if (Array.isArray(data)) {
      const usageByProduct = new Map<string, number>();
      for (const row of data as Array<{ product_id?: string; usage?: number }>) {
        const pid = typeof row.product_id === "string" ? row.product_id : "";
        if (!pid) continue;
        usageByProduct.set(pid, (usageByProduct.get(pid) ?? 0) + Number(row.usage ?? 0));
      }
      const out: Record<string, number> = {};
      for (const [pid, usage] of usageByProduct.entries()) {
        out[pid] = Math.round(Math.max(0, usage) * multiplier);
      }
      return out;
    }
  } catch {
    // fall back below
  }

  // Fallback: compute from raw history (sum of negative diffs).
  const rows = await (async () => {
    const supabase = getSupabase() as unknown as {
      from: (t: string) => {
        select: (columns: string) => {
          gte: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };

    const { data, error } = await supabase
      .from("inventory_history")
      .select("location_id,product_id,quantity,timestamp,is_transfer")
      .gte("timestamp", sinceIso);
    if (error) throw error;
    return (data ?? []) as Array<{
      location_id: string;
      product_id: string;
      quantity: number;
      timestamp: string;
      is_transfer?: boolean;
    }>;
  })();

  const byKey = new Map<string, Array<{ t: number; q: number }>>();
  for (const r of rows) {
    if (r.is_transfer) continue;
    const key = `${r.location_id}:${r.product_id}`;
    const arr = byKey.get(key) ?? [];
    arr.push({ t: Date.parse(r.timestamp), q: Number(r.quantity ?? 0) });
    byKey.set(key, arr);
  }

  const usageByProduct = new Map<string, number>();
  for (const [key, arr] of byKey.entries()) {
    arr.sort((a, b) => a.t - b.t);
    let usage = 0;
    for (let i = 1; i < arr.length; i++) {
      const diff = arr[i]!.q - arr[i - 1]!.q;
      if (diff < 0) usage += -diff;
    }
    const productId = key.split(":")[1] ?? "";
    if (!productId) continue;
    usageByProduct.set(productId, (usageByProduct.get(productId) ?? 0) + usage);
  }

  const out: Record<string, number> = {};
  for (const [pid, usage] of usageByProduct.entries()) {
    out[pid] = Math.round(usage * multiplier);
  }
  return out;
}

export async function getWeeklyUsageByLocationProduct(args?: {
  days?: number;
  multiplier?: number;
}): Promise<Record<string, Record<string, number>>> {
  const days = args?.days ?? 7;
  const multiplier = args?.multiplier ?? 1;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Preferred: SQL window function (lag) via RPC.
  try {
    const supabase = getSupabase() as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await supabase.rpc("usage_by_location_product_since", {
      p_since: sinceIso,
    });
    if (error) throw error;
    if (Array.isArray(data)) {
      const out: Record<string, Record<string, number>> = {};
      for (const row of data as Array<{
        location_id?: string;
        product_id?: string;
        usage?: number;
      }>) {
        const lid = typeof row.location_id === "string" ? row.location_id : "";
        const pid = typeof row.product_id === "string" ? row.product_id : "";
        if (!lid || !pid) continue;
        if (!out[lid]) out[lid] = {};
        out[lid][pid] = Math.round(Math.max(0, Number(row.usage ?? 0)) * multiplier);
      }
      return out;
    }
  } catch {
    // fall back below
  }

  // Fallback: compute from raw history (sum of negative diffs).
  const rows = await (async () => {
    const supabase = getSupabase() as unknown as {
      from: (t: string) => {
        select: (columns: string) => {
          gte: (column: string, value: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };

    const { data, error } = await supabase
      .from("inventory_history")
      .select("location_id,product_id,quantity,timestamp,is_transfer")
      .gte("timestamp", sinceIso);
    if (error) throw error;
    return (data ?? []) as Array<{
      location_id: string;
      product_id: string;
      quantity: number;
      timestamp: string;
      is_transfer?: boolean;
    }>;
  })();

  const byKey = new Map<string, Array<{ t: number; q: number }>>();
  for (const r of rows) {
    if (r.is_transfer) continue;
    const key = `${r.location_id}:${r.product_id}`;
    const arr = byKey.get(key) ?? [];
    arr.push({ t: Date.parse(r.timestamp), q: Number(r.quantity ?? 0) });
    byKey.set(key, arr);
  }

  const out: Record<string, Record<string, number>> = {};
  for (const [key, arr] of byKey.entries()) {
    arr.sort((a, b) => a.t - b.t);
    let usage = 0;
    for (let i = 1; i < arr.length; i++) {
      const diff = arr[i]!.q - arr[i - 1]!.q;
      if (diff < 0) usage += -diff;
    }
    const [locationId, productId] = key.split(":");
    if (!locationId || !productId) continue;
    if (!out[locationId]) out[locationId] = {};
    out[locationId][productId] = Math.round(usage * multiplier);
  }
  return out;
}

