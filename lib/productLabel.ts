import type { Product } from "@/lib/types";
import { formatProductName } from "@/lib/formatProductName";

export function productLabel(p: Pick<Product, "brand" | "product_name" | "zusatz">) {
  return formatProductName(p);
}

