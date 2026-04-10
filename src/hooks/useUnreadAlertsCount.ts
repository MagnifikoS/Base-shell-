/**
 * useUnreadAlertsCount — Returns the count of unread notification_events (read_at IS NULL)
 *
 * Used by MobileBottomNav to show a red badge on the Notifications icon.
 * Reads from notification_events table (real notifications sent by edge function).
 * 
 * SSOT: Uses service day UTC range for correct filtering.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { getServiceDayUtcRange } from "@/lib/time/serviceDayRange";

export function useUnreadAlertsCount(): number {
  const { activeEstablishmentId: establishmentId } = useEstablishmentAccess();

  const { data: count = 0 } = useQuery({
    queryKey: ["notification-events-count", establishmentId],
    queryFn: async (): Promise<number> => {
      if (!establishmentId) return 0;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;

      const { data: serviceDay } = await supabase.rpc("get_service_day_now", {
        _establishment_id: establishmentId,
      });
      if (!serviceDay) return 0;

      // Get establishment cutoff for correct UTC range
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";
      const { startUtc, endUtc } = getServiceDayUtcRange(serviceDay, cutoffHHMM);

      const { count: eventCount, error } = await supabase
        .from("notification_events")
        .select("id", { count: "exact", head: true })
        .eq("establishment_id", establishmentId)
        .eq("recipient_user_id", user.id)
        .is("read_at", null)
        .gte("sent_at", startUtc)
        .lt("sent_at", endUtc);

      if (error) return 0;
      return eventCount || 0;
    },
    enabled: !!establishmentId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return count;
}
