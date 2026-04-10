import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { ExtractionSettings, DEFAULT_EXTRACTION_SETTINGS } from "../types";
import { toast } from "sonner";

/**
 * Hook to manage extraction settings for the current establishment
 */
export function useExtractionSettings() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();
  const establishmentId = activeEstablishment?.id;

  const { data: settings, isLoading } = useQuery({
    queryKey: ["extraction-settings", establishmentId],
    queryFn: async (): Promise<ExtractionSettings> => {
      if (!establishmentId) {
        throw new Error("No establishment selected");
      }

      const { data, error } = await supabase
        .from("extraction_settings")
        .select(
          "id, organization_id, establishment_id, filter_existing_products, show_existing_products_debug, price_variation_enabled, price_variation_tolerance_pct, price_variation_blocking, abnormal_quantity_enabled, abnormal_quantity_tolerance_pct, abnormal_quantity_blocking, rarely_bought_enabled, rarely_bought_threshold_count, rarely_bought_period_months, missing_price_enabled, missing_price_blocking, atypical_invoice_enabled"
        )
        .eq("establishment_id", establishmentId)
        .maybeSingle();

      if (error) throw error;

      // If no settings exist, return defaults (will be created on first save)
      if (!data) {
        return {
          id: "",
          organization_id: "",
          establishment_id: establishmentId,
          ...DEFAULT_EXTRACTION_SETTINGS,
        };
      }

      return data as ExtractionSettings;
    },
    enabled: !!establishmentId,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<ExtractionSettings>) => {
      if (!establishmentId || !activeEstablishment?.organization_id) {
        throw new Error("No establishment selected");
      }

      // Upsert: create if doesn't exist, update if exists
      const { error } = await supabase.from("extraction_settings").upsert(
        {
          establishment_id: establishmentId,
          organization_id: activeEstablishment.organization_id,
          ...updates,
        },
        { onConflict: "establishment_id" }
      );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extraction-settings", establishmentId] });
      toast.success("Paramètres enregistrés");
    },
    onError: (error) => {
      if (import.meta.env.DEV) console.error("Failed to save extraction settings:", error);
      toast.error("Erreur lors de la sauvegarde");
    },
  });

  return {
    settings: settings ?? {
      id: "",
      organization_id: "",
      establishment_id: establishmentId ?? "",
      ...DEFAULT_EXTRACTION_SETTINGS,
    },
    isLoading,
    updateSettings: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}
