/**
 * useNotificationEvents — Fetches notification_events from DB for the current user
 * 
 * Shows real notifications sent by the notif-check-badgeuse edge function.
 * For admins: shows alerts about employees (with employee name from payload).
 * For employees: shows their own alerts.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { getServiceDayUtcRange } from "@/lib/time/serviceDayRange";

export interface NotificationEvent {
  id: string;
  alert_key: string;
  alert_type: string;
  establishment_id: string;
  recipient_user_id: string;
  rule_id: string;
  sent_at: string;
  read_at: string | null;
  payload: {
    title?: string;
    body?: string;
    minutes?: number;
    source_user_id?: string;
    source_user_name?: string;
    sent?: boolean;
    no_subscription?: boolean;
    engine_version?: string;
    role_id?: string;
    body_from_config?: string;
    wave?: number;
    max_waves?: number;
    employee_name?: string | null;
  } | null;
  /** Resolved from profiles join */
  source_user_name?: string;
  /** Computed: true if event is from legacy engine (pre-v2.4) */
  isLegacy?: boolean;
}

/**
 * Detect if a notification event is from the legacy engine (pre-v2.4).
 * Legacy events lack engine_version, role_id, body_from_config, or use old alert_key format.
 */
export function isLegacyEvent(event: NotificationEvent): boolean {
  // Commande notifications are NEVER legacy (they don't use engine_version/role_id pattern)
  if (event.alert_type?.startsWith("commande_")) return false;

  const p = event.payload;
  if (!p) return true;
  if (!p.engine_version) return true;
  if (!p.role_id) return true;
  if (!p.body_from_config) return true;
  if (!event.alert_key?.includes(":R")) return true;
  return false;
}

/**
 * Detect if a body contains unresolved template variables like {employee_name}, {minutes}
 */
export function hasUnresolvedTemplateVars(body: string | undefined | null): boolean {
  if (!body) return false;
  return /\{[a-zA-Z_]+\}/.test(body);
}

export function useNotificationEvents() {
  const { activeEstablishmentId: establishmentId } = useEstablishmentAccess();

  return useQuery({
    queryKey: ["notification-events", establishmentId],
    queryFn: async (): Promise<NotificationEvent[]> => {
      if (!establishmentId) return [];

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get today's service day (SSOT via RPC)
      const { data: serviceDay } = await supabase.rpc("get_service_day_now", {
        _establishment_id: establishmentId,
      });
      if (!serviceDay) return [];

      // Get establishment cutoff (SSOT from DB)
      const { data: establishment } = await supabase
        .from("establishments")
        .select("service_day_cutoff")
        .eq("id", establishmentId)
        .single();

      const cutoffHHMM = establishment?.service_day_cutoff?.slice(0, 5) || "03:00";

      // Compute correct UTC range for this service day
      // Service day D with cutoff C runs from D@C (Paris) → D+1@C (Paris), converted to UTC
      const { startUtc, endUtc } = getServiceDayUtcRange(serviceDay, cutoffHHMM);

      const { data: events, error } = await supabase
        .from("notification_events")
        .select("*")
        .eq("establishment_id", establishmentId)
        .eq("recipient_user_id", user.id)
        .gte("sent_at", startUtc)
        .lt("sent_at", endUtc)
        .order("sent_at", { ascending: false });

      if (error) throw error;
      if (!events || events.length === 0) return [];

      // Collect source_user_ids from payloads to resolve names
      const sourceUserIds = new Set<string>();
      for (const e of events) {
        const payload = e.payload as NotificationEvent["payload"];
        if (payload?.source_user_id) {
          sourceUserIds.add(payload.source_user_id);
        }
      }

      // Fetch profile names for source users
      const nameMap = new Map<string, string>();
      if (sourceUserIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", Array.from(sourceUserIds));
        
        for (const p of profiles || []) {
          nameMap.set(p.user_id, p.full_name || "Inconnu");
        }
      }

      // Enrich events with resolved names
      return events.map((e) => {
        const payload = e.payload as NotificationEvent["payload"];
        return {
          ...e,
          payload,
          source_user_name: payload?.source_user_id 
            ? nameMap.get(payload.source_user_id) || "Inconnu"
            : undefined,
        };
      });
    },
    enabled: !!establishmentId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
