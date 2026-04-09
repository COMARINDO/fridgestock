export type User = {
  id: string; // uuid
  name: string;
  password: string;
};

export type Product = {
  id: string; // uuid
  name: string;
  min_quantity: number;
  barcode?: string | null;
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
};

