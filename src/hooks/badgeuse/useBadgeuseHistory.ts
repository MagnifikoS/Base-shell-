/**
 * @deprecated ALIAS to usePresenceByDate - DO NOT USE DIRECTLY
 * Kept for backwards compatibility only.
 * All new code should use usePresenceByDate.
 * 
 * This file can be deleted once all imports are updated.
 */

export {
  usePresenceByDate as useBadgeuseHistory,
  type UsePresenceByDateParams,
  type UsePresenceByDateResult,
} from "@/hooks/presence/usePresenceByDate";

// Re-export types for backwards compatibility
export type { PresenceEmployeeCard as BadgeuseHistoryResult } from "@/lib/presence/presence.compute";
