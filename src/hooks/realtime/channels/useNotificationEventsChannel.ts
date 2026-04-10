/**
 * useNotificationEventsChannel — Realtime listener for notification_events
 *
 * Shows a toast on the home screen when a new notification_event is inserted
 * for the current user. Also invalidates the notification count badge.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useNotificationEventsChannel(
  establishmentId: string | null,
  enabled: boolean
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!enabled || !establishmentId || !userId) return;

    const channel = supabase
      .channel(`notif-events-${establishmentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification_events",
          filter: `establishment_id=eq.${establishmentId}`,
        },
        (payload) => {
          const event = payload.new as {
            recipient_user_id: string;
            alert_type: string;
            payload: {
              title?: string;
              body?: string;
              source_user_id?: string;
            } | null;
          };

          // Only process if this notification is for the current user
          if (event.recipient_user_id !== userId) return;

          // Show toast
          const title = event.payload?.title || "Nouvelle alerte";
          const body = event.payload?.body || "";
          const message = body ? `${title} — ${body}` : title;

          const isWarning =
            event.alert_type === "no_badge_arrival" ||
            event.alert_type === "no_badge_departure" ||
            event.alert_type === "no_badge" ||
            event.alert_type === "missing_clock_out";

          const isCommande = event.alert_type?.startsWith("commande_");
          const isCommandeWarning =
            event.alert_type === "commande_expediee_partielle" ||
            event.alert_type === "commande_reception_validee_partielle";

          if (isWarning || isCommandeWarning) {
            toast.warning(message);
          } else if (isCommande) {
            toast.info(message);
          } else {
            toast.info(message);
          }

          // Invalidate notification counts + events list
          queryClient.invalidateQueries({
            queryKey: ["notification-events-count", establishmentId],
          });
          queryClient.invalidateQueries({
            queryKey: ["notification-events", establishmentId],
          });
          queryClient.invalidateQueries({
            queryKey: ["alerts", establishmentId],
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, establishmentId, userId, queryClient]);
}
