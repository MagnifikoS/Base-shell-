/**
 * ═══════════════════════════════════════════════════════════════════════════
 * USE TEAM TAB KEYS — Read-only hook to map user's teamIds to tabKeys
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This hook fetches team names from the database and normalizes them to tabKeys
 * for use in navigation filtering (scope=team → show only matching children).
 *
 * PURE READ-ONLY:
 * - No writes to database
 * - No side effects
 * - Uses RLS-protected query on teams table
 *
 * NORMALIZATION:
 * - Lowercase, trim, remove accents, spaces → single lowercase word
 * - "Cuisine" → "cuisine", "Salle" → "salle", "Plonge" → "plonge"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface UseTeamTabKeysParams {
  /** Active establishment ID (required for filtering) */
  establishmentId: string | null;
  /** User's team IDs from permissions */
  teamIds: string[];
}

interface UseTeamTabKeysResult {
  /** Normalized tabKeys corresponding to user's teams */
  teamTabKeys: string[];
  /** Loading state */
  isLoading: boolean;
}

/**
 * Normalize team name to tabKey.
 * - Lowercase
 * - Trim whitespace
 * - Remove accents (é→e, è→e, etc.)
 * - Replace spaces with nothing (single word)
 *
 * Examples:
 * - "Cuisine" → "cuisine"
 * - "Salle" → "salle"
 * - "Plonge" → "plonge"
 * - "Pizza" → "pizza"
 * - "Service Général" → "servicegeneral"
 */
function normalizeToTabKey(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      // Remove accents
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Remove spaces and special chars (keep only alphanumeric)
      .replace(/[^a-z0-9]/g, "")
  );
}

/**
 * Fetch team names for given teamIds and normalize to tabKeys.
 */
async function fetchTeamTabKeys(establishmentId: string, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) {
    return [];
  }

  // Query teams table (RLS protected) to get names for user's teams
  // Note: We query by team ID, not establishment, since teams are org-level
  // but user_teams links user to teams
  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .in("id", teamIds)
    .eq("status", "active");

  if (error) {
    if (import.meta.env.DEV) console.error("[useTeamTabKeys] Error fetching teams:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Normalize names to tabKeys and deduplicate
  const tabKeys = [...new Set(data.map((team) => normalizeToTabKey(team.name)))];

  return tabKeys;
}

/**
 * Hook to get normalized tabKeys for user's teams.
 *
 * @param params - establishmentId and teamIds from permissions
 * @returns teamTabKeys array and loading state
 */
export function useTeamTabKeys({
  establishmentId,
  teamIds,
}: UseTeamTabKeysParams): UseTeamTabKeysResult {
  const enabled = !!establishmentId && teamIds.length > 0;

  const { data: teamTabKeys = [], isLoading } = useQuery({
    queryKey: ["team-tab-keys", establishmentId, teamIds.join(",")],
    queryFn: () => fetchTeamTabKeys(establishmentId!, teamIds),
    enabled,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — team names rarely change
    gcTime: 10 * 60 * 1000,
  });

  // Return empty array if not enabled (safe fallback)
  if (!enabled) {
    return { teamTabKeys: [], isLoading: false };
  }

  return { teamTabKeys, isLoading };
}
