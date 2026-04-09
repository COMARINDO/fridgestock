import { getSupabase } from "@/lib/supabase";
import type {
  InventoryHistoryRow,
  InventoryRow,
  Location,
  Product,
  User,
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

export async function loginWithNamePassword(name: string, password: string) {
  const { data, error } = await from("users")
    .select("id,name,password")
    .eq("name", name)
    .maybeSingle();

  if (error) throw error;
  const row = data as unknown as
    | { id: string; name: string; password: string }
    | null;
  if (!row) return null;
  if (row.password !== password) return null;

  return { id: row.id, name: row.name };
}

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
    .select("id,name,min_quantity,barcode,short_name")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  const code = barcode.trim();
  if (!code) return null;
  const { data, error } = await from("products")
    .select("id,name,min_quantity,barcode,short_name")
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
        "id,name,min_quantity,barcode,short_name,inventory:inventory!left(quantity,location_id)"
      )
      .eq("inventory.location_id", loc);

    if (!error && Array.isArray(data)) {
      const rows = data as Array<
        Product & {
          short_name?: string | null;
          inventory?: Array<{ quantity?: number | null; location_id?: string | null }>;
        }
      >;

      // If join filter caused an unintended inner join (missing products), fall back.
      if (rows.length > 0) {
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          min_quantity: p.min_quantity,
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

export async function listUsers(): Promise<Pick<User, "id" | "name">[]> {
  const { data, error } = await from("users").select("id,name").order("name");
  if (error) throw error;
  return (data ?? []) as Pick<User, "id" | "name">[];
}

export async function setInventoryQuantity(args: {
  userId: string;
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
    user_id: args.userId,
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
  name: string;
  barcode: string;
  min_quantity?: number;
  short_name?: string | null;
}) {
  const { error } = await from("products").insert({
    name: args.name,
    barcode: args.barcode,
    min_quantity: args.min_quantity ?? 0,
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

