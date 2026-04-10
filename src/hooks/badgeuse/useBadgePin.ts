import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";

interface PinStatus {
  has_pin: boolean;
  created_at: string | null;
}

export function useBadgePinStatus() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  return useQuery({
    queryKey: ["badge-pin-status", establishmentId],
    queryFn: async (): Promise<PinStatus> => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Not authenticated");
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-pin`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to fetch PIN status");
      }

      return res.json();
    },
    staleTime: 10 * 60 * 1000, // PERF-10: Static data — PIN status rarely changes
  });
}

export function useCreateBadgePin() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;

  return useMutation({
    mutationFn: async (pin: string): Promise<void> => {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error("Not authenticated");
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/badge-pin`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to set PIN");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badge-pin-status", establishmentId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Une erreur est survenue lors de la configuration du PIN");
    },
  });
}
