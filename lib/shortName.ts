export function suggestShortName(args: {
  name: string;
  zusatz?: string | null;
}): string {
  const name = (args.name ?? "").trim();
  const zusatz = (args.zusatz ?? "").trim();

  const firstWord = name.split(/\s+/).filter(Boolean)[0] ?? "";
  const lettersOnly = firstWord.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const prefix = lettersOnly.slice(0, 2).toLowerCase();

  // Extract number like "0,5" / "0.25" / "1" from zusatz and remove "l".
  // Examples:
  // "0,5l" -> "0,5"
  // "0.25l" -> "0,25"
  const m = zusatz.replace(/\s+/g, "").match(/(\d+(?:[.,]\d+)?)/);
  const num = m?.[1] ? m[1].replace(".", ",") : "";

  const parts = [prefix, num].filter(Boolean);
  return parts.join(" ").trim();
}

