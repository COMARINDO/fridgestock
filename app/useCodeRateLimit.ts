"use client";

import { useSyncExternalStore } from "react";
import {
  getCodeRateLimitSnapshot,
  getServerCodeRateLimitSnapshot,
  subscribeCodeRateLimit,
} from "@/lib/codeRateLimit";

export function useCodeRateLimit() {
  return useSyncExternalStore(
    subscribeCodeRateLimit,
    getCodeRateLimitSnapshot,
    getServerCodeRateLimitSnapshot
  );
}
