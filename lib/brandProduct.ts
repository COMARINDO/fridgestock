export function splitNameToBrandProduct(raw: string): { brand: string; product_name: string } {
  const t = (raw ?? "").trim();
  if (!t) return { brand: "", product_name: "" };

  // Prefer "Brand - Product" style
  const dash = t.split(/\s*-\s*/);
  if (dash.length >= 2) {
    const brand = (dash[0] ?? "").trim();
    const product_name = dash.slice(1).join(" - ").trim();
    return { brand, product_name };
  }

  // Fallback: first word = brand, rest = product name
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { brand: parts[0], product_name: "" };
  return { brand: parts[0], product_name: parts.slice(1).join(" ") };
}

