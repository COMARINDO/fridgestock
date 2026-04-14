export function isBakeryEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENABLE_BAKERY;
  return v === "1" || v === "true" || v === "TRUE" || v === "yes";
}

