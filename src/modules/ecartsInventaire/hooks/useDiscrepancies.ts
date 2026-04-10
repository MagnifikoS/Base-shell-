/**
 * ═══════════════════════════════════════════════════════════════
 * useDiscrepancies — Query hook for inventory_discrepancies
 * ═══════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { DiscrepancyWithDetails } from "../types";

export function useDiscrepancies() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["inventory-discrepancies", estId],
    queryFn: async (): Promise<DiscrepancyWithDetails[]> => {
      if (!estId) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("inventory_discrepancies")
        .select(`
          *,
          products_v2!inner(nom_produit),
          storage_zones(name),
          measurement_units(abbreviation, name)
        `)
        .eq("establishment_id", estId)
        .order("withdrawn_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((row: any) => ({
        ...row,
        product_name: row.products_v2?.nom_produit ?? "Produit inconnu",
        zone_name: row.storage_zones?.name ?? null,
        unit_label: row.measurement_units?.abbreviation ?? row.measurement_units?.name ?? null,
        // Clean up nested objects
        products_v2: undefined,
        storage_zones: undefined,
        measurement_units: undefined,
      }));
    },
    enabled: !!estId,
    staleTime: 30_000,
  });
}

/** Count of open discrepancies (for badge) */
export function useOpenDiscrepancyCount(): number {
  const { data } = useDiscrepancies();
  if (!data) return 0;
  return data.filter((d) => d.status === "open").length;
}
