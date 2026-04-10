/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Toggle hook
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reads and toggles the mutualisation setting for the current establishment.
 * Uses upsert so the row is created on first toggle.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const QUERY_KEY = "mutualisation-enabled";

export function useMutualisationEnabled() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id ?? null;
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: enabled = false, isLoading } = useQuery({
    queryKey: [QUERY_KEY, establishmentId],
    enabled: !!establishmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_mutualisation_settings")
        .select("enabled")
        .eq("establishment_id", establishmentId!)
        .maybeSingle();

      if (error) throw error;
      return data?.enabled ?? false;
    },
  });

  const { mutate: toggle, isPending } = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from("inventory_mutualisation_settings")
        .upsert(
          {
            establishment_id: establishmentId!,
            enabled: newValue,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
          },
          { onConflict: "establishment_id" }
        );
      if (error) throw error;
    },
    onSuccess: (_data, newValue) => {
      qc.setQueryData([QUERY_KEY, establishmentId], newValue);
      toast.success(
        newValue
          ? "Mutualisation d'affichage activée"
          : "Mutualisation d'affichage désactivée"
      );
    },
    onError: () => {
      toast.error("Erreur lors de la mise à jour");
    },
  });

  return { enabled, isLoading, toggle, isPending };
}
