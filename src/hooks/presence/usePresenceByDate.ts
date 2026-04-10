/**
 * Unified hook for fetching presence data for ANY service day
 * SINGLE SOURCE OF TRUTH for both Presence (today) and History (arbitrary date)
 * V1.0: Created from usePresenceData, parameterized by dayDate
 * V2.0: Added service_day_cutoff (SSOT) for overnight shift handling
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNowParisHHMM } from "@/lib/time/paris";
import { getTodayDateKeyParis } from "@/lib/time/dateKeyParis";
import {
  computePresenceData,
  groupByEmployee,
  mergeBadgeOnlyUsers,
  applyPlanningModificationFlags,
  type PlannedShift,
  type BadgeEvent,
  type PresenceEmployeeCard,
} from "@/lib/presence/presence.compute";

export interface UsePresenceByDateParams {
  establishmentId: string | null | undefined;
  dayDate: string; // YYYY-MM-DD (service day)
  enabled?: boolean;
}

export interface UsePresenceByDateResult {
  employees: PresenceEmployeeCard[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  dayDate: string;
}

export function usePresenceByDate({
  establishmentId,
  dayDate,
  enabled = true,
}: UsePresenceByDateParams): UsePresenceByDateResult {
  const query = useQuery({
    // Stable 3-part key: ["presence", establishmentId, dayDate]
    // For "today" dayDate will be the resolved service day string
    queryKey: ["presence", establishmentId, dayDate],
    queryFn: async (): Promise<PresenceEmployeeCard[]> => {
      if (!establishmentId || !dayDate) return [];

      // ═══════════════════════════════════════════════════════════════════════
      // Query 0: Fetch establishment's service_day_cutoff (SSOT for overnight)
      // ═══════════════════════════════════════════════════════════════════════
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      // Query 1: Planning shifts for the day (V13: include updated_at for modification detection)
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("user_id, start_time, end_time, updated_at")
        .eq("shift_date", dayDate)
        .eq("establishment_id", establishmentId);

      if (shiftsError) {
        throw new Error(`Failed to load planning: ${shiftsError.message}`);
      }

      // Extract unique user IDs from shifts
      const userIds = [...new Set((shifts || []).map((s) => s.user_id))];

      // Query 2: Profiles for those users
      let profilesMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", userIds);

        if (profilesError) {
          throw new Error(`Failed to load profiles: ${profilesError.message}`);
        }

        profilesMap = new Map((profiles || []).map((p) => [p.user_id, p.full_name || "Inconnu"]));
      }

      // Query 3: Badge events for the day (V13: include created_at for modification detection)
      const { data: events, error: eventsError } = await supabase
        .from("badge_events")
        .select(
          "id, user_id, event_type, occurred_at, effective_at, day_date, sequence_index, late_minutes, created_at"
        )
        .eq("day_date", dayDate)
        .eq("establishment_id", establishmentId);

      if (eventsError) {
        throw new Error(`Failed to load badge events: ${eventsError.message}`);
      }

      // Get all user IDs (shifts + events) for team lookup
      const eventUserIds = [...new Set((events || []).map((e) => e.user_id))];
      const allUserIds = [...new Set([...userIds, ...eventUserIds])];

      // Query 4: User teams with team names (DETERMINISTIC: order by created_at ASC, take first)
      const teamMap = new Map<string, { teamId: string; teamName: string }>();
      if (allUserIds.length > 0) {
        const { data: userTeams, error: teamsError } = await supabase
          .from("user_teams")
          .select("user_id, team_id, created_at, teams(id, name)")
          .in("user_id", allUserIds)
          .order("created_at", { ascending: true });

        if (!teamsError && userTeams) {
          for (const ut of userTeams) {
            // Only take first occurrence per user (oldest team = deterministic)
            if (!teamMap.has(ut.user_id)) {
              const teamData = ut.teams as { id: string; name: string } | null;
              if (teamData) {
                teamMap.set(ut.user_id, { teamId: teamData.id, teamName: teamData.name });
              }
            }
          }
        }
      }

      // Reconstruct shifts with profiles and sequence_index
      const shiftsByUser = new Map<string, typeof shifts>();
      for (const s of shifts || []) {
        const existing = shiftsByUser.get(s.user_id) || [];
        existing.push(s);
        shiftsByUser.set(s.user_id, existing);
      }

      // Sort each user's shifts by start_time and assign sequence_index
      const shiftsWithProfiles: PlannedShift[] = [];
      for (const [, userShifts] of shiftsByUser) {
        userShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
        userShifts.forEach((s, idx) => {
          shiftsWithProfiles.push({
            user_id: s.user_id,
            start_time: s.start_time,
            end_time: s.end_time,
            sequence_index: idx + 1,
            profiles: { full_name: profilesMap.get(s.user_id) || "Inconnu" },
          });
        });
      }

      // V13: Build shift updated_at map for planning modification detection
      const shiftUpdatedAtMap = new Map<string, string>();
      for (const [userId, userShifts] of shiftsByUser) {
        userShifts.forEach((s, idx) => {
          const key = `${userId}:${idx + 1}`;
          if (s.updated_at) {
            shiftUpdatedAtMap.set(key, s.updated_at);
          }
        });
      }

      // Compute presence data with SSOT cutoff for overnight handling
      // FIX: For past service days, force nowParis to end-of-service-day
      // so all shifts are correctly marked as finished (enables "Oubli sortie" detection)
      const todayServiceDay = getTodayDateKeyParis();
      const isPastDay = dayDate < todayServiceDay;

      let nowParis: string;
      if (isPastDay) {
        // Force to 1 minute before cutoff = last minute of that service day
        // e.g. cutoff "03:00" → "02:59" means all shifts on that day are finished
        const [cutH, cutM] = cutoffHHMM.split(":").map(Number);
        const totalMin = cutH * 60 + cutM - 1;
        const endH = Math.floor(((totalMin % 1440) + 1440) % 1440 / 60);
        const endM = ((totalMin % 1440) + 1440) % 1440 % 60;
        nowParis = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      } else {
        nowParis = getNowParisHHMM();
      }
      const legacyData = computePresenceData(
        shiftsWithProfiles,
        (events || []) as BadgeEvent[],
        nowParis,
        cutoffHHMM
      );
      const groupedCards = groupByEmployee(legacyData, cutoffHHMM);

      // V13: Apply planning modification detection
      applyPlanningModificationFlags(groupedCards, shiftUpdatedAtMap);

      // Add team info to each card
      for (const card of groupedCards) {
        const team = teamMap.get(card.userId);
        if (team) {
          card.teamId = team.teamId;
          card.teamName = team.teamName;
        }
      }

      // Merge badge-only users
      const unplannedUserIds = eventUserIds.filter((id) => !userIds.includes(id));
      if (unplannedUserIds.length > 0) {
        const { data: extraProfiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", unplannedUserIds);

        for (const p of extraProfiles || []) {
          profilesMap.set(p.user_id, p.full_name || "Inconnu");
        }
      }

      const mergedCards = mergeBadgeOnlyUsers(
        groupedCards,
        (events || []) as BadgeEvent[],
        profilesMap
      );

      // Add team info to badge-only cards too
      for (const card of mergedCards) {
        if (!card.teamId) {
          const team = teamMap.get(card.userId);
          if (team) {
            card.teamId = team.teamId;
            card.teamName = team.teamName;
          }
        }
      }

      return mergedCards;
    },
    enabled: enabled && !!establishmentId && !!dayDate,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
    // PERF-04: Removed refetchInterval — realtime channel (badge_events) handles updates
  });

  return {
    employees: query.data || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    dayDate,
  };
}
