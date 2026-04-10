/**
 * Unified cache invalidation for Presence / Historique / Badgeuse
 * SINGLE SOURCE OF TRUTH for invalidating presence-related queries
 *
 * Phase 2.1: All mutations must use this helper to ensure UI sync
 */

import type { QueryClient } from "@tanstack/react-query";

interface InvalidatePresenceParams {
  queryClient: QueryClient;
  establishmentId: string | undefined;
  dayDate: string; // YYYY-MM-DD format (service day)
}

/**
 * Invalidate all presence-related queries for a specific establishment + day
 * This ensures Presence, Historique, and Badgeuse views all refresh
 */
export function invalidatePresenceQueries({
  queryClient,
  establishmentId,
  dayDate,
}: InvalidatePresenceParams): void {
  if (!establishmentId || !dayDate) {
    if (import.meta.env.DEV)
      console.warn("[invalidatePresenceQueries] Missing establishmentId or dayDate", {
        establishmentId,
        dayDate,
      });
    return;
  }

  // ✅ PRIMARY: Invalidate the exact presence query for this day
  queryClient.invalidateQueries({
    queryKey: ["presence", establishmentId, dayDate],
  });

  // ✅ SECONDARY: Also invalidate any partial matches (for fuzzy cases)
  // This catches edge cases where components might have slightly different keys
  queryClient.invalidateQueries({
    queryKey: ["presence", establishmentId],
    exact: false,
  });

  // ✅ DEPENDENT: Invalidate derived data caches (prefix by establishmentId for precision)
  queryClient.invalidateQueries({
    queryKey: ["late", establishmentId],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ["extras", establishmentId],
    exact: false,
  });
  // ✅ ABSENCE: Keys are ["absence", "monthly", estId, ...] and ["absence", "detail", estId, ...]
  // Scoped invalidation by establishmentId
  queryClient.invalidateQueries({
    queryKey: ["absence", "monthly", establishmentId],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ["absence", "detail", establishmentId],
    exact: false,
  });
  // ✅ FIX 1 (Phase 2.6): Invalidate alerts for this establishment
  queryClient.invalidateQueries({
    queryKey: ["alerts", establishmentId],
    exact: false,
  });
}

/**
 * Compute the Monday of the week containing the given date
 * Used for badge-status invalidation
 */
export function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  const year = monday.getFullYear();
  const month = (monday.getMonth() + 1).toString().padStart(2, "0");
  const dayOfMonth = monday.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

/**
 * Full invalidation including badge-status (for badgeuse views)
 */
export function invalidatePresenceAndBadgeStatus({
  queryClient,
  establishmentId,
  dayDate,
}: InvalidatePresenceParams): void {
  // Invalidate presence first
  invalidatePresenceQueries({ queryClient, establishmentId, dayDate });

  // Also invalidate badge-status for the week
  if (establishmentId && dayDate) {
    const weekStart = getWeekStart(dayDate);
    queryClient.invalidateQueries({
      queryKey: ["badge-status", establishmentId, weekStart],
    });
    // Also invalidate without weekStart for broader match
    queryClient.invalidateQueries({
      queryKey: ["badge-status", establishmentId],
      exact: false,
    });
  }
}
