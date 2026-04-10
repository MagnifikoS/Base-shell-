/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE FAVORITES — Isolated, removable user preference system
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Stores favorite nav item IDs per user in localStorage.
 * Fully isolated: removing this file + its consumers = zero impact.
 *
 * KEY FORMAT: mobile_favorites_v1::<userId>
 * STORAGE: string[] of navRegistry item IDs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { NAV_REGISTRY } from "@/config/navRegistry";

const STORAGE_PREFIX = "mobile_favorites_v1";

function getKey(userId: string): string {
  return `${STORAGE_PREFIX}::${userId}`;
}

function isValidNavId(id: string): boolean {
  return NAV_REGISTRY.some(
    (item) => item.id === id && !item.hidden && !item.adminOnly
  );
}

function loadFavorites(userId: string | null): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(getKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter(isValidNavId) : [];
  } catch {
    return [];
  }
}

function saveFavorites(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(getKey(userId), JSON.stringify(ids));
    // Notify other hook instances in the same tab
    window.dispatchEvent(new CustomEvent("mobile-favorites-changed", { detail: userId }));
  } catch {
    // Silent
  }
}

export function useMobileFavorites(userId: string | null) {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    loadFavorites(userId)
  );

  // Sync when userId changes
  useEffect(() => {
    setFavoriteIds(loadFavorites(userId));
  }, [userId]);

  // Listen for changes from other hook instances (same tab)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === userId) {
        setFavoriteIds(loadFavorites(userId));
      }
    };
    window.addEventListener("mobile-favorites-changed", handler);
    return () => window.removeEventListener("mobile-favorites-changed", handler);
  }, [userId]);

  const toggleFavorite = useCallback(
    (id: string) => {
      if (!userId) return;
      setFavoriteIds((prev) => {
        const next = prev.includes(id)
          ? prev.filter((f) => f !== id)
          : [...prev, id];
        saveFavorites(userId, next);
        return next;
      });
    },
    [userId]
  );

  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(id),
    [favoriteIds]
  );

  return { favoriteIds, toggleFavorite, isFavorite };
}
