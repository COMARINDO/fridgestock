export type PendingInventoryWrite = {
  id: string;
  userId: string;
  locationId: string;
  productId: string;
  quantity: number;
  createdAt: number;
};

const KEY = "fridge.pendingWrites.v1";

function readAll(): PendingInventoryWrite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr as PendingInventoryWrite[];
  } catch {
    return [];
  }
}

function writeAll(items: PendingInventoryWrite[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueWrite(w: Omit<PendingInventoryWrite, "id" | "createdAt">) {
  const items = readAll();
  // De-dup by (locationId, productId): keep latest quantity.
  const existingIdx = items.findIndex(
    (x) => x.locationId === w.locationId && x.productId === w.productId
  );
  const item: PendingInventoryWrite = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    ...w,
  };
  if (existingIdx >= 0) items.splice(existingIdx, 1);
  items.push(item);
  writeAll(items);
}

export function pendingCount() {
  return readAll().length;
}

export async function flushQueue(
  writer: (w: PendingInventoryWrite) => Promise<void>
) {
  const items = readAll();
  if (items.length === 0) return;
  const remaining: PendingInventoryWrite[] = [];
  for (const w of items) {
    try {
      await writer(w);
    } catch {
      remaining.push(w);
    }
  }
  writeAll(remaining);
}

