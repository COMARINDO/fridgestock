"use client";

import { useEffect, useState } from "react";
import {
  getCodeRateLimitSnapshot,
  getServerCodeRateLimitSnapshot,
  subscribeCodeRateLimit,
  type CodeRateLimitSnapshot,
} from "@/lib/codeRateLimit";

export function useCodeRateLimit(): CodeRateLimitSnapshot {
  const [snapshot, setSnapshot] = useState<CodeRateLimitSnapshot>(() =>
    getServerCodeRateLimitSnapshot()
  );

  useEffect(() => {
    const sync = () => setSnapshot(getCodeRateLimitSnapshot());
    sync();
    return subscribeCodeRateLimit(sync);
  }, []);

  return snapshot;
}
