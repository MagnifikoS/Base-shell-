import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BadgeSettings } from "@/components/mobile/badgeuse/types/badgeuse.types";

const DEFAULT_SETTINGS: BadgeSettings = {
  establishment_id: "",
  arrival_tolerance_min: 10,
  departure_tolerance_min: 20,
  extra_threshold_min: 20,
  require_selfie: true,
  require_pin: true,
  device_binding_enabled: true,
  max_devices_per_user: 1,
  early_arrival_limit_min: 30,
};

interface UseBadgeSettingsOptions {
  establishmentId: string | null;
}

export function useBadgeSettings({ establishmentId }: UseBadgeSettingsOptions) {
  return useQuery({
    queryKey: ["badge-settings", establishmentId],
    queryFn: async (): Promise<BadgeSettings> => {
      if (!establishmentId) {
        return { ...DEFAULT_SETTINGS };
      }

      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Not authenticated");
      }

      const _response = await supabase.functions.invoke("badge-settings", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: undefined,
      });

      // Handle query params manually since invoke doesn't support them well
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-settings?establishment_id=${establishmentId}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to fetch settings");
      }

      const data = await res.json();
      return data.settings as BadgeSettings;
    },
    enabled: !!establishmentId,
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — settings rarely change
  });
}
