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
};

export type Location = {
  id: string; // uuid
  name: string;
  parent_id: string | null; // uuid
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
};

export type OrderOverrideRow = {
  location_id: string;
  product_id: string;
  quantity: number;
  updated_at: string;
};

