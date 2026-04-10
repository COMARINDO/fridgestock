import type { Product } from "@/lib/types";

export function groupProducts(products: Product[]): Record<string, Product[]> {
  const groups = new Map<string, Product[]>();

  for (const p of products) {
    const brandRaw = (p.brand ?? "").trim();
    const key = brandRaw ? brandRaw : "Sonstige";
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Sonstige" && b !== "Sonstige") return 1;
    if (b === "Sonstige" && a !== "Sonstige") return -1;
    return a.localeCompare(b);
  });

  const out: Record<string, Product[]> = {};
  for (const k of keys) {
    const list = (groups.get(k) ?? []).slice().sort((a, b) =>
      (a.product_name ?? "").localeCompare(b.product_name ?? "")
    );
    out[k] = list;
  }
  return out;
}

