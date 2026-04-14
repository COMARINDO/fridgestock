const BAKERY_OVERRIDE_KEY = "fridge.flags.bakery.enabled.v1";

function envBakeryEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ENABLE_BAKERY;
  return v === "1" || v === "true" || v === "TRUE" || v === "yes";
}

function localOverrideEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BAKERY_OVERRIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isBakeryEnabled(): boolean {
  // Env enables it for everyone (preferred). Local override enables it per device.
  return envBakeryEnabled() || localOverrideEnabled();
}

export function enableBakeryLocally(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BAKERY_OVERRIDE_KEY, "1");
    window.dispatchEvent(new Event("storage"));
  } catch {
    // ignore
  }
}

export function disableBakeryLocally(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BAKERY_OVERRIDE_KEY);
    window.dispatchEvent(new Event("storage"));
  } catch {
    // ignore
  }
}

