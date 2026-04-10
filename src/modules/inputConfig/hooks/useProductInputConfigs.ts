/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHARED HOOK — Load product_input_config for active establishment
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns a Map<productId, ProductInputConfigRow> for fast lookup.
 * Used by all operational flows (reception, withdrawal, etc.)
 * to read the source of truth for input preferences.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { ProductInputConfigRow } from "../types";

export function useProductInputConfigs() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const { data: configMap = new Map<string, ProductInputConfigRow>() } = useQuery({
    queryKey: ["product-input-configs", estId],
    queryFn: async () => {
      if (!estId) return new Map<string, ProductInputConfigRow>();

      const { data, error } = await supabase
        .from("product_input_config")
        .select("*")
        .eq("establishment_id", estId);

      if (error) throw error;

      const map = new Map<string, ProductInputConfigRow>();
      for (const row of data ?? []) {
        map.set(row.product_id, row as ProductInputConfigRow);
      }
      return map;
    },
    enabled: !!estId,
    staleTime: 60_000,
  });

  return configMap;
}
