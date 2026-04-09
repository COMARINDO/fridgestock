export function favoritesKey(userId: string, locationId: string) {
  return `fridge.favs.v1.${userId}.${locationId}`;
}

export function readFavorites(userId: string, locationId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(favoritesKey(userId, locationId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === "string") as string[];
  } catch {
    return [];
  }
}

export function writeFavorites(
  userId: string,
  locationId: string,
  ids: string[]
) {
  window.localStorage.setItem(
    favoritesKey(userId, locationId),
    JSON.stringify(Array.from(new Set(ids)))
  );
}

