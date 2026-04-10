import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServiceDayToday } from "@/hooks/useServiceDayToday";
import type { BadgeEvent, BadgeStatus } from "@/components/mobile/badgeuse/types/badgeuse.types";

interface UseBadgeStatusOptions {
  establishmentId: string | null;
  weekStart: string;
}

export function useBadgeStatus({ establishmentId, weekStart }: UseBadgeStatusOptions) {
  // ✅ GOLD RULE: Use RPC get_service_day_now - single source of truth for "today"
  const { data: serviceDay, isLoading: isServiceDayLoading } = useServiceDayToday(establishmentId);

  const query = useQuery({
    queryKey: ["badge-status", establishmentId, weekStart, serviceDay],
    queryFn: async (): Promise<{ status: BadgeStatus; weekEvents: BadgeEvent[] }> => {
      if (!establishmentId) {
        throw new Error("No establishment selected");
      }
      if (!serviceDay) {
        throw new Error("Service day not resolved");
      }

      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Not authenticated");
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-events?establishment_id=${establishmentId}&week_start=${weekStart}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to fetch badge events");
      }

      const data = await res.json();
      const weekEvents: BadgeEvent[] = data.events || [];

      // ✅ Use RPC service day (Europe/Paris, DST-safe) - NOT browser local time
      const today = serviceDay;
      const todayEvents = weekEvents.filter((e) => e.day_date === today);

      let isClockedIn = false;
      let lastEvent: BadgeEvent | null = null;
      let nextEventType: "clock_in" | "clock_out" = "clock_in";
      let currentSequence = 1;
      let canBadge = true;

      // V13: Track session state for forgotten badge detection
      const sessionsBySeq: Record<number, { hasClockIn: boolean; hasClockOut: boolean }> = {};

      if (todayEvents.length > 0) {
        // Build sessions map
        for (const ev of todayEvents) {
          if (!sessionsBySeq[ev.sequence_index]) {
            sessionsBySeq[ev.sequence_index] = { hasClockIn: false, hasClockOut: false };
          }
          if (ev.event_type === "clock_in") sessionsBySeq[ev.sequence_index].hasClockIn = true;
          if (ev.event_type === "clock_out") sessionsBySeq[ev.sequence_index].hasClockOut = true;
        }

        lastEvent = todayEvents[todayEvents.length - 1];
        isClockedIn = lastEvent.event_type === "clock_in";

        if (isClockedIn) {
          nextEventType = "clock_out";
          currentSequence = lastEvent.sequence_index;
        } else {
          nextEventType = "clock_in";
          currentSequence = lastEvent.sequence_index + 1;
          // Max 2 shifts per day
          if (currentSequence > 2) {
            canBadge = false;
          }
        }
      }

      // V13: Detect forgotten badge anomalies
      let forgottenBadgeWarning: string | null = null;

      // Check forgotten clock_out: sequence 1 has clock_in but no clock_out, now on sequence 2
      if (currentSequence >= 2 && sessionsBySeq[1]?.hasClockIn && !sessionsBySeq[1]?.hasClockOut) {
        forgottenBadgeWarning = "Oubli de pointage détecté pour le premier shift";
      }

      // Check orphan clock_out (no clock_in) in any sequence
      for (const seqStr of Object.keys(sessionsBySeq)) {
        const sess = sessionsBySeq[Number(seqStr)];
        if (sess.hasClockOut && !sess.hasClockIn) {
          forgottenBadgeWarning = `Arrivée non enregistrée (shift ${seqStr})`;
          break;
        }
      }

      return {
        status: {
          isClockedIn,
          lastEvent,
          nextEventType,
          currentSequence,
          canBadge,
          todayEvents,
          forgottenBadgeWarning,
          hasMismatch: false,
        },
        weekEvents,
      };
    },
    enabled: !!establishmentId && !!serviceDay,
    staleTime: 0, // PERF-10: Realtime-backed — always refetch on mount
  });

  // Combine loading states
  return {
    ...query,
    isLoading: isServiceDayLoading || query.isLoading,
  };
}
