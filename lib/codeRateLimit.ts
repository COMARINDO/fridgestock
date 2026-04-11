export const CODE_ATTEMPTS_KEY = "code_attempts";
export const CODE_LOCK_UNTIL_KEY = "code_lock_until";

const MAX_FAILED_ATTEMPTS = 3;
const LOCK_MS = 5 * 60 * 1000;

export type CodeRateLimitSnapshot = {
  locked: boolean;
  attempts: number;
  lockUntil: number | null;
  remainingMs: number;
};

const defaultSnapshot: CodeRateLimitSnapshot = {
  locked: false,
  attempts: 0,
  lockUntil: null,
  remainingMs: 0,
};

const storeListeners = new Set<() => void>();

export function notifyCodeRateLimitChanged(): void {
  storeListeners.forEach((fn) => {
    fn();
  });
}

/**
 * Reads state and clears an expired lock (mutates localStorage when expired).
 */
export function getCodeRateLimitSnapshot(): CodeRateLimitSnapshot {
  if (typeof window === "undefined") return defaultSnapshot;

  const lockRaw = localStorage.getItem(CODE_LOCK_UNTIL_KEY);
  const attemptsRaw = localStorage.getItem(CODE_ATTEMPTS_KEY);
  const now = Date.now();

  let lockUntil: number | null =
    lockRaw != null && lockRaw !== "" ? Number(lockRaw) : null;
  if (lockUntil != null && Number.isNaN(lockUntil)) lockUntil = null;

  if (lockUntil != null && now >= lockUntil) {
    localStorage.removeItem(CODE_LOCK_UNTIL_KEY);
    localStorage.setItem(CODE_ATTEMPTS_KEY, "0");
    lockUntil = null;
  }

  const attempts = Math.max(0, Number(attemptsRaw) || 0);

  if (lockUntil != null && now < lockUntil) {
    return {
      locked: true,
      attempts,
      lockUntil,
      remainingMs: lockUntil - now,
    };
  }

  return {
    locked: false,
    attempts,
    lockUntil: null,
    remainingMs: 0,
  };
}

export function getServerCodeRateLimitSnapshot(): CodeRateLimitSnapshot {
  return defaultSnapshot;
}

export function subscribeCodeRateLimit(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  storeListeners.add(onStoreChange);

  const onStorage = (e: StorageEvent) => {
    if (
      e.key === CODE_LOCK_UNTIL_KEY ||
      e.key === CODE_ATTEMPTS_KEY ||
      e.key === null
    ) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    storeListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Counts one failed submission (wrong / unknown code). No-op while locked. */
export function recordFailedCodeAttempt(): void {
  if (typeof window === "undefined") return;

  const snap = getCodeRateLimitSnapshot();
  if (snap.locked) return;

  const next = snap.attempts + 1;
  localStorage.setItem(CODE_ATTEMPTS_KEY, String(next));
  if (next >= MAX_FAILED_ATTEMPTS) {
    localStorage.setItem(CODE_LOCK_UNTIL_KEY, String(Date.now() + LOCK_MS));
  }
  notifyCodeRateLimitChanged();
}

/** Call after any successful code validation (admin or location). */
export function clearCodeRateLimitOnSuccess(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CODE_LOCK_UNTIL_KEY);
  localStorage.setItem(CODE_ATTEMPTS_KEY, "0");
  notifyCodeRateLimitChanged();
}

export function formatLockRemaining(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Call ~1/s while UI shows a lock countdown so expiry clears storage and notifies subscribers. */
export function tickCodeRateLimitClock(): void {
  if (typeof window === "undefined") return;
  const hadLock = localStorage.getItem(CODE_LOCK_UNTIL_KEY);
  getCodeRateLimitSnapshot();
  const stillLocked = localStorage.getItem(CODE_LOCK_UNTIL_KEY);
  if (hadLock && !stillLocked) notifyCodeRateLimitChanged();
}
