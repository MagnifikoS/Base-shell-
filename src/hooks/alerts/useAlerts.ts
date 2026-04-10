/**
 * Phase 0 Alerts Hook - READ ONLY
 *
 * Derives alerts from existing data sources:
 * - planning_shifts (today's planned shifts)
 * - badge_events (today's clock in/out events)
 *
 * NO DB WRITES, NO NEW TABLES, NO EDGE FUNCTION CHANGES
 * Fully removable without migration
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getNowParisHHMM, normalizeToServiceDayTimeline } from "@/lib/time/paris";

// Hardcoded tolerance for Phase 0 (20 minutes)
const ALERT_TOLERANCE_MIN = 20;

export interface BadgeAlert {
  id: string; // unique key for React
  userId: string;
  fullName: string;
  type: "missing_clock_in" | "missing_clock_out";
  plannedStart: string; // HH:mm
  plannedEnd: string; // HH:mm
  sequenceIndex: number;
  shiftId: string;
}

export interface UseAlertsResult {
  alerts: BadgeAlert[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  today: string;
}

/**
 * Fetch alerts for an establishment (READ ONLY)
 * Returns missing clock_in and missing clock_out alerts
 */
export function useAlerts(establishmentId: string | null): UseAlertsResult {
  const query = useQuery({
    queryKey: ["alerts", establishmentId],
    queryFn: async (): Promise<{ alerts: BadgeAlert[]; today: string }> => {
      if (!establishmentId) return { alerts: [], today: "" };

      // ✅ GOLD RULE: Use RPC get_service_day_now - single source of truth
      const { data: serviceDay, error: serviceDayError } = await supabase.rpc(
        "get_service_day_now",
        { _establishment_id: establishmentId }
      );

      if (serviceDayError) {
        throw new Error(`Failed to get service day: ${serviceDayError.message}`);
      }
      if (!serviceDay) {
        throw new Error("get_service_day_now returned null - invalid establishment?");
      }

      const today = serviceDay; // YYYY-MM-DD from RPC

      // ═══════════════════════════════════════════════════════════════════════
      // SSOT: Fetch establishment's service_day_cutoff for overnight handling
      // ═══════════════════════════════════════════════════════════════════════
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      const nowHHMM = getNowParisHHMM();
      const nowMin = normalizeToServiceDayTimeline(nowHHMM, cutoffHHMM);

      // Query 1: Planning shifts for today
      const { data: shifts, error: shiftsError } = await supabase
        .from("planning_shifts")
        .select("id, user_id, start_time, end_time")
        .eq("shift_date", today)
        .eq("establishment_id", establishmentId);

      if (shiftsError) {
        throw new Error(`Failed to load planning: ${shiftsError.message}`);
      }

      if (!shifts || shifts.length === 0) {
        return { alerts: [], today };
      }

      // Get unique user IDs
      const userIds = [...new Set(shifts.map((s) => s.user_id))];

      // Query 2: Profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      if (profilesError) {
        throw new Error(`Failed to load profiles: ${profilesError.message}`);
      }

      const profilesMap = new Map(
        (profiles || []).map((p) => [p.user_id, p.full_name || "Inconnu"])
      );

      // Query 3: Badge events for today
      const { data: events, error: eventsError } = await supabase
        .from("badge_events")
        .select("user_id, event_type, sequence_index")
        .eq("day_date", today)
        .eq("establishment_id", establishmentId);

      if (eventsError) {
        throw new Error(`Failed to load badge events: ${eventsError.message}`);
      }

      // Build lookup: userId -> sequenceIndex -> { hasClockIn, hasClockOut }
      const eventLookup = new Map<
        string,
        Map<number, { hasClockIn: boolean; hasClockOut: boolean }>
      >();

      for (const event of events || []) {
        if (!eventLookup.has(event.user_id)) {
          eventLookup.set(event.user_id, new Map());
        }
        const userMap = eventLookup.get(event.user_id)!;
        const seq = event.sequence_index || 1;
        if (!userMap.has(seq)) {
          userMap.set(seq, { hasClockIn: false, hasClockOut: false });
        }
        const entry = userMap.get(seq)!;
        if (event.event_type === "clock_in") entry.hasClockIn = true;
        if (event.event_type === "clock_out") entry.hasClockOut = true;
      }

      // Group shifts by user and assign sequence index
      const shiftsByUser = new Map<string, typeof shifts>();
      for (const s of shifts) {
        const existing = shiftsByUser.get(s.user_id) || [];
        existing.push(s);
        shiftsByUser.set(s.user_id, existing);
      }

      // Sort and assign sequence
      for (const [, userShifts] of shiftsByUser) {
        userShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
      }

      const alerts: BadgeAlert[] = [];

      for (const [userId, userShifts] of shiftsByUser) {
        userShifts.forEach((shift, index) => {
          const seqIndex = index + 1;
          const startHHMM = shift.start_time.slice(0, 5);
          const endHHMM = shift.end_time.slice(0, 5);

          // ═══════════════════════════════════════════════════════════════════
          // V2: Use SSOT cutoff for overnight handling
          // ═══════════════════════════════════════════════════════════════════
          const startMin = normalizeToServiceDayTimeline(startHHMM, cutoffHHMM);
          let endMin = normalizeToServiceDayTimeline(endHHMM, cutoffHHMM);

          // Handle edge case: if end <= start after normalization, add 1440
          if (endMin <= startMin) {
            endMin += 1440;
          }

          const userEvents = eventLookup.get(userId)?.get(seqIndex) || {
            hasClockIn: false,
            hasClockOut: false,
          };
          const fullName = profilesMap.get(userId) || "Inconnu";

          // Case A: Missing clock_in
          // now > planned_start + 20min AND no clock_in
          if (nowMin > startMin + ALERT_TOLERANCE_MIN && !userEvents.hasClockIn) {
            alerts.push({
              id: `${shift.id}-missing-in`,
              userId,
              fullName,
              type: "missing_clock_in",
              plannedStart: startHHMM,
              plannedEnd: endHHMM,
              sequenceIndex: seqIndex,
              shiftId: shift.id,
            });
          }

          // Case B: Missing clock_out
          // now > planned_end + 20min AND clock_in present but no clock_out
          if (
            nowMin > endMin + ALERT_TOLERANCE_MIN &&
            userEvents.hasClockIn &&
            !userEvents.hasClockOut
          ) {
            alerts.push({
              id: `${shift.id}-missing-out`,
              userId,
              fullName,
              type: "missing_clock_out",
              plannedStart: startHHMM,
              plannedEnd: endHHMM,
              sequenceIndex: seqIndex,
              shiftId: shift.id,
            });
          }
        });
      }

      return { alerts, today };
    },
    enabled: !!establishmentId,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
    // PERF-04: Removed refetchInterval — realtime channel (badge_events) handles updates
  });

  return {
    alerts: query.data?.alerts || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    today: query.data?.today || "",
  };
}
