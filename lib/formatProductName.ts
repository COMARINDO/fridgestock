import type { Product } from "@/lib/types";

export function formatProductName(
  product: Pick<Product, "brand" | "product_name" | "zusatz">
): string {
  const brand = (product.brand ?? "").trim();
  const name = (product.product_name ?? "").trim();
  const zusatz = (product.zusatz ?? "").trim();

  const parts: string[] = [];
  if (brand) parts.push(brand);
  if (name) parts.push(name);
  if (zusatz) parts.push(zusatz);

  // Edge case: if both brand + zusatz missing, show only product_name
  if (parts.length === 0) return "";
  if (!brand && name && !zusatz) return name;

  return parts.join(" - ");
}

