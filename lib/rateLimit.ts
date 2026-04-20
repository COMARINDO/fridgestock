/**
 * Sehr einfache In-Memory Rate-Limit fuer Public-API-Routes.
 *
 * - Reicht voellig fuer Single-Region-Deployments (Vercel) als Schutz vor
 *   versehentlichen Spam-Submits aus dem Chat.
 * - State lebt im Lambda/Edge-Worker, nicht ueber Instanzen hinweg. Das ist
 *   bewusst (keine Redis-Abhaengigkeit) und absichtlich nur "good enough".
 * - Fuer ernsthaftes Abuse-Handling spaeter durch Redis/Upstash ersetzen.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Anzahl erlaubter Requests pro Fenster. Default: 8 */
  limit?: number;
  /** Fensterbreite in ms. Default: 10 Minuten */
  windowMs?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  opts: RateLimitOptions = {}
): RateLimitResult {
  const limit = Math.max(1, opts.limit ?? 8);
  const windowMs = Math.max(1000, opts.windowMs ?? 10 * 60 * 1000);
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: 0,
  };
}

export function ipFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip");
  return real?.trim() || "unknown";
}
