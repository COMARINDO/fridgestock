const EMPTY = "";

/**
 * Shared server-side secret for high-impact admin actions routed via Next APIs.
 * Keep this value server-only; client uses it only through dedicated API routes.
 */
export function getServerActionSecret(): string {
  return process.env.SERVER_ACTION_SECRET?.trim() ?? EMPTY;
}

export function hasServerActionSecret(): boolean {
  return getServerActionSecret().length > 0;
}

