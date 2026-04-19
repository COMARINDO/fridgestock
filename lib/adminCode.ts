/**
 * Shared admin PIN for the client-side admin mode gate.
 *
 * Wird zur Build-Zeit aus `NEXT_PUBLIC_ADMIN_CODE` gelesen. Dieser Wert landet
 * über das Browser-Bundle beim User — er ist also kein "Geheimnis", schützt
 * aber den UI-Toggle in den Admin-Modus vor zufälligem Aktivieren und kann
 * jederzeit über Vercel-Env rotiert werden, ohne Code-Push.
 *
 * Echte Server-seitige Admin-Aktionen werden gegen `SERVER_ACTION_SECRET`
 * geprüft (siehe `lib/serverActionSecret.ts`). Für Backups gilt zusätzlich
 * `ADMIN_BACKUP_CODE`.
 *
 * Fallback `"1402"` ist nur für lokale Dev-Umgebungen ohne `.env.local`.
 */
export const ADMIN_CODE: string =
  (process.env.NEXT_PUBLIC_ADMIN_CODE ?? "").trim() || "1402";
