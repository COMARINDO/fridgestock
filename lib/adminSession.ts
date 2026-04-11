/** Device-local admin flag (no backend). Key must match product requirement. */
export const ADMIN_STORAGE_KEY = "isAdmin";

const ADMIN_EVENT = "bstand-admin";

export function readIsAdminFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ADMIN_STORAGE_KEY) === "true";
}

export function setAdminSessionTrue(): void {
  window.localStorage.setItem(ADMIN_STORAGE_KEY, "true");
  window.dispatchEvent(new Event(ADMIN_EVENT));
}

export function clearAdminSession(): void {
  window.localStorage.removeItem(ADMIN_STORAGE_KEY);
  window.dispatchEvent(new Event(ADMIN_EVENT));
}

export function subscribeAdmin(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener("storage", handler);
  window.addEventListener(ADMIN_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(ADMIN_EVENT, handler);
  };
}
