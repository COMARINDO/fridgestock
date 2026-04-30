export const PRODUCT_LIST_CATEGORIES = ["kuehl", "metro", "gebaeck"] as const;
export type ProductListCategory = (typeof PRODUCT_LIST_CATEGORIES)[number];

export const DEFAULT_LIST_CATEGORY: ProductListCategory = "kuehl";

export const PRODUCT_LIST_LABELS: Record<ProductListCategory, string> = {
  kuehl: "Kühl",
  metro: "Metro",
  gebaeck: "Gebäck",
};

export function parseListCategory(v: string | null | undefined): ProductListCategory {
  if (v === "kuehl" || v === "metro" || v === "gebaeck") return v;
  return DEFAULT_LIST_CATEGORY;
}
