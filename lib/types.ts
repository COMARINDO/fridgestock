export type User = {
  id: string; // uuid
  name: string;
  password: string;
};

export type Product = {
  id: string; // uuid
  brand: string;
  product_name: string;
  zusatz?: string | null;
  barcode?: string | null;
  short_name?: string | null;
  min_quantity?: number | null;
  /** Admin-only fields (optional in DB) */
  supplier?: string | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  metro_order_number?: string | null;
  metro_unit?: string | null;
};

export type Location = {
  id: string; // uuid
  name: string;
  parent_id: string | null; // uuid
  type?: "warehouse" | "outlet" | "independent" | null;
  warehouse_location_id?: string | null; // uuid
};

export type InventoryRow = {
  location_id: string; // uuid
  product_id: string; // uuid
  quantity: number;
};

export type InventoryHistoryRow = {
  id: string; // uuid
  user_id: string | null; // uuid
  location_id: string; // uuid
  product_id: string; // uuid
  quantity: number;
  timestamp: string;
  /** Internal Rabenstein↔Teich transfer; excluded from usage lag. */
  is_transfer?: boolean;
  mode?: "count" | "add" | "transfer" | null;
};

export type InventoryCountSession = {
  session_no: number;
  started_at: string;
  ended_at: string;
  count_rows: number;
  distinct_products: number;
};

export type InventorySessionSnapshotRow = {
  product_id: string;
  brand: string;
  product_name: string;
  zusatz: string;
  short_name: string;
  quantity: number;
  counted_at: string;
};

export type InventoryMissingCountRow = {
  product_id: string;
  brand: string;
  product_name: string;
  zusatz: string;
  short_name: string;
  last_quantity: number;
  last_count_at: string | null;
};

export type OrderOverrideRow = {
  location_id: string;
  product_id: string;
  quantity: number;
  updated_at: string;
};

export type SubmittedOrderItem = {
  product_id: string;
  quantity: number;
};

export type SubmittedOrderRow = {
  id: string; // uuid
  location_id: string; // uuid
  iso_year: number;
  iso_week: number;
  created_at: string;
  delivered_at?: string | null;
  items: SubmittedOrderItem[];
};
