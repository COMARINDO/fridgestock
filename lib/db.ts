import { getSupabase } from "@/lib/supabase";
import type {
  InventoryHistoryRow,
  InventoryRow,
  Location,
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

export async function listLocations(): Promise<Location[]> {
  const { data, error } = await from("locations")
    .select("id,name,parent_id")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Location[];
}

export async function getLocation(id: string): Promise<Location | null> {
  const { data, error } = await from("locations")
    .select("id,name,parent_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Location | null;
}

export async function resolveInventoryLocation(locationId: string): Promise<{
  uiLocation: Location;
  inventoryLocation: Location;
}> {
  const loc = await getLocation(locationId);
  if (!loc) throw new Error("Location nicht gefunden.");
  if (!loc.parent_id) {
    return { uiLocation: loc, inventoryLocation: loc };
  }
  const parent = await getLocation(loc.parent_id);
  if (!parent) throw new Error("Parent-Location nicht gefunden.");
  return { uiLocation: loc, inventoryLocation: parent };
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await from("products")
    .select("id,brand,product_name,zusatz,barcode,short_name")
    .order("brand");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  const code = barcode.trim();
  if (!code) return null;
  const { data, error } = await from("products")
    .select("id,brand,product_name,zusatz,barcode,short_name")
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
        "id,brand,product_name,zusatz,barcode,short_name,inventory:inventory!left(quantity,location_id)"
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
  const [products, locations, inv] = await Promise.all([
    listProducts(),
    listLocations(),
    listInventoryAll(),
  ]);

  const parentIds = new Set(locations.filter((l) => !l.parent_id).map((l) => l.id));
  const totals = new Map<string, number>();
  for (const row of inv) {
    if (!parentIds.has(row.location_id)) continue;
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
}

export async function createProductWithBarcode(args: {
  brand?: string | null;
  product_name?: string | null;
  zusatz?: string | null;
  barcode: string;
  short_name?: string | null;
}) {
  if (!args.brand?.trim()) throw new Error("Brand fehlt.");
  if (!args.product_name?.trim()) throw new Error("Produkt fehlt.");
  const { error } = await from("products").insert({
    brand: args.brand ?? "",
    product_name: args.product_name ?? "",
    zusatz: args.zusatz ?? null,
    barcode: args.barcode,
    short_name: args.short_name ?? null,
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
    })
    .eq("id", args.productId);
  if (error) throw error;
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

  const [locs, rows] = await Promise.all([
    listLocations(),
    (async () => {
      const supabase = getSupabase() as unknown as {
        from: (t: string) => {
          select: (columns: string) => {
            gte: (
              column: string,
              value: string
            ) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };

      const { data, error } = await supabase
        .from("inventory_history")
        .select("location_id,product_id,quantity,timestamp")
        .gte("timestamp", sinceIso);
      if (error) throw error;
      return (data ?? []) as Array<{
        location_id: string;
        product_id: string;
        quantity: number;
        timestamp: string;
      }>;
    })(),
  ]);

  const parentIds = new Set(locs.filter((l) => !l.parent_id).map((l) => l.id));

  // Per (location, product): min/max over last N days.
  const minmax = new Map<string, { min: number; max: number }>();
  for (const r of rows) {
    if (!parentIds.has(r.location_id)) continue;
    const key = `${r.location_id}:${r.product_id}`;
    const cur = minmax.get(key);
    if (!cur) {
      minmax.set(key, { min: r.quantity ?? 0, max: r.quantity ?? 0 });
      continue;
    }
    const q = r.quantity ?? 0;
    if (q < cur.min) cur.min = q;
    if (q > cur.max) cur.max = q;
  }

  // Sum usage across locations for each product.
  const usageByProduct = new Map<string, number>();
  for (const [key, mm] of minmax.entries()) {
    const productId = key.split(":")[1] ?? "";
    if (!productId) continue;
    const usage = Math.max(0, mm.max - mm.min);
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

  const [locs, rows] = await Promise.all([
    listLocations(),
    (async () => {
      const supabase = getSupabase() as unknown as {
        from: (t: string) => {
          select: (columns: string) => {
            gte: (
              column: string,
              value: string
            ) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };

      const { data, error } = await supabase
        .from("inventory_history")
        .select("location_id,product_id,quantity,timestamp")
        .gte("timestamp", sinceIso);
      if (error) throw error;
      return (data ?? []) as Array<{
        location_id: string;
        product_id: string;
        quantity: number;
        timestamp: string;
      }>;
    })(),
  ]);

  const parentIds = new Set(locs.filter((l) => !l.parent_id).map((l) => l.id));

  const minmax = new Map<string, { min: number; max: number }>();
  for (const r of rows) {
    if (!parentIds.has(r.location_id)) continue;
    const key = `${r.location_id}:${r.product_id}`;
    const cur = minmax.get(key);
    const q = r.quantity ?? 0;
    if (!cur) {
      minmax.set(key, { min: q, max: q });
      continue;
    }
    if (q < cur.min) cur.min = q;
    if (q > cur.max) cur.max = q;
  }

  const out: Record<string, Record<string, number>> = {};
  for (const [key, mm] of minmax.entries()) {
    const [locationId, productId] = key.split(":");
    if (!locationId || !productId) continue;
    const usage = Math.max(0, mm.max - mm.min);
    const scaled = Math.round(usage * multiplier);
    if (!out[locationId]) out[locationId] = {};
    out[locationId][productId] = scaled;
  }
  return out;
}

