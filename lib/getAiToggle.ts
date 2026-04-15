export function getAiToggle(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const val = window.localStorage.getItem("useAiConsumption.v1");
    return val === "true";
  } catch {
    return false;
  }
}

