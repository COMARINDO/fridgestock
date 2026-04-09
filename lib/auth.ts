export type SessionUser = { id: string; name: string };

const STORAGE_KEY = "fridge.session.v1";

export function getStoredUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "name" in parsed &&
      typeof (parsed as Record<string, unknown>).name === "string"
    ) {
      const obj = parsed as Record<string, unknown>;
      const idVal = obj.id;
      // Backwards compatible: older sessions might have numeric ids.
      const id =
        typeof idVal === "string"
          ? idVal
          : typeof idVal === "number"
            ? String(idVal)
            : null;
      if (!id) return null;
      return { id, name: obj.name as string };
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: SessionUser) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  window.localStorage.removeItem(STORAGE_KEY);
}

