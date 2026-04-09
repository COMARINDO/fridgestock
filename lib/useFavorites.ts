"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { readFavorites, writeFavorites } from "@/lib/favorites";

function makeKey(userId: string, locationId: string) {
  return `fav:${userId}:${locationId}`;
}

const eventName = "fridge-favs";

export function useFavorites(userId: string | null, locationId: string | null) {
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    if (!userId || !locationId) {
      setFavs([]);
      return;
    }
    setFavs(readFavorites(userId, locationId));

    const handler = () => {
      setFavs(readFavorites(userId, locationId));
    };

    window.addEventListener("storage", handler);
    window.addEventListener(eventName, handler as EventListener);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(eventName, handler as EventListener);
    };
  }, [userId, locationId]);

  const toggle = useCallback(
    (productId: string) => {
      if (!userId || !locationId) return;
      const set = new Set(favs);
      if (set.has(productId)) set.delete(productId);
      else set.add(productId);
      const next = Array.from(set);
      writeFavorites(userId, locationId, next);
      setFavs(next);
      window.dispatchEvent(new Event(eventName));
    },
    [favs, userId, locationId]
  );

  return {
    favs,
    toggle,
    key: userId && locationId ? makeKey(userId, locationId) : null,
  };
}

