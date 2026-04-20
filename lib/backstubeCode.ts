/**
 * Shared Backstube-Code fuer den /backstube Login.
 *
 * Wird sowohl client (Login-Form) als auch server (API-Route) gelesen.
 * Default-Wert "Backstube26" gilt, wenn `NEXT_PUBLIC_BACKSTUBE_CODE` nicht
 * gesetzt ist. Der Code ist client-sichtbar; das ist akzeptabel, weil
 * Backstube nur eine reine Anzeige-Sicht ist (read-only).
 */
export const BACKSTUBE_CODE: string =
  (process.env.NEXT_PUBLIC_BACKSTUBE_CODE ?? "").trim() || "Backstube26";

export const BACKSTUBE_LOCATION_NAME = "Backstube";
