import { getSupabase } from "@/lib/supabase";
import type {
  InventoryHistoryRow,
  InventoryRow,
  Location,
  Product,
  User,
} from "@/lib/types";

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

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await from("products")
    .select("id,name,min_quantity,barcode")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  const code = barcode.trim();
  if (!code) return null;
  const { data, error } = await from("products")
    .select("id,name,min_quantity,barcode")
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
  // Preferred (atomic): optional RPC if installed in Supabase.
  try {
    const supabase = getSupabase() as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ error: unknown }>;
    };

    const { error } = await supabase.rpc("set_inventory_snapshot", {
      p_user_id: args.userId,
      p_location_id: args.locationId,
      p_product_id: args.productId,
      p_quantity: args.quantity,
    });
    if (!error) return;
    // fallthrough to non-RPC implementation if function missing or fails
  } catch {
    // ignore and fall back
  }

  // Fallback (2 calls): upsert inventory then append history.
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      upsert: (
        values: Record<string, unknown>,
        options: Record<string, unknown>
      ) => Promise<{ error: unknown }>;
      insert: (values: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
  };

  const { error: upsertErr } = await supabase
    .from("inventory")
    .upsert(
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
  if (histErr) throw histErr;
}

export async function deleteProduct(productId: string) {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      delete: () => { eq: (c: string, v: unknown) => Promise<{ error: unknown }> };
    };
  };
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;
}

export async function deleteLocation(locationId: string) {
  const supabase = getSupabase() as unknown as {
    from: (t: string) => {
      delete: () => { eq: (c: string, v: unknown) => Promise<{ error: unknown }> };
    };
  };
  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  if (error) throw error;
}

// Admin helpers
export async function adminCreateProduct(args: {
  name: string;
  min_quantity: number;
  barcode?: string | null;
}) {
  const { error } = await from("products").insert({
    name: args.name,
    min_quantity: args.min_quantity,
    barcode: args.barcode ?? null,
  });
  if (error) throw error;
}

export async function createProductWithBarcode(args: {
  name: string;
  barcode: string;
  min_quantity?: number;
}) {
  const { error } = await from("products").insert({
    name: args.name,
    barcode: args.barcode,
    min_quantity: args.min_quantity ?? 0,
  });
  if (error) throw error;
}

export async function adminCreateLocation(args: {
  name: string;
  parent_id: string | null;
}) {
  const { error } = await from("locations").insert({
    name: args.name,
    parent_id: args.parent_id,
  });
  if (error) throw error;
}

export async function adminCreateUser(args: { name: string; password: string }) {
  const { error } = await from("users").insert({
    name: args.name,
    password: args.password,
  });
  if (error) throw error;
}

