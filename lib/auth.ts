export type SessionLocation = { location_id: string };

const STORAGE_KEY = "fridge.location.v1";

export function getStoredLocation(): SessionLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "location_id" in parsed &&
      typeof (parsed as Record<string, unknown>).location_id === "string"
    ) {
      const obj = parsed as Record<string, unknown>;
      const id = obj.location_id as string;
      if (!id.trim()) return null;
      return { location_id: id };
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredLocation(location: SessionLocation) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
}

export function clearStoredLocation() {
  window.localStorage.removeItem(STORAGE_KEY);
}

