export type OfflineQueueItem =
  | {
      type: "count";
      locationId: string;
      productId: string;
      quantity: number;
      timestamp: number;
    }
  | {
      type: "add";
      locationId: string;
      productId: string;
      delta: number;
      timestamp: number;
    };

const KEY = "offlineQueue.v1";

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getQueue(): OfflineQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = safeParse(window.localStorage.getItem(KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed as OfflineQueueItem[];
  } catch {
    return [];
  }
}

export function saveQueue(queue: OfflineQueueItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export function addToQueue(item: OfflineQueueItem): void {
  const q = getQueue();
  q.push(item);
  saveQueue(q);
}

export function removeFirstFromQueue(): OfflineQueueItem | null {
  const q = getQueue();
  if (q.length === 0) return null;
  const first = q.shift() ?? null;
  saveQueue(q);
  return first;
}

