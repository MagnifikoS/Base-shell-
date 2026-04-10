/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE — Hook to fetch conversion rules from DB
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { ConversionRule, UnitWithFamily } from "./types";

export function useUnitConversions() {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const conversionsQuery = useQuery({
    queryKey: ["unit-conversions", estId],
    queryFn: async (): Promise<ConversionRule[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("unit_conversions")
        .select("id, from_unit_id, to_unit_id, factor, establishment_id, is_active")
        .eq("establishment_id", estId)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        factor: Number(r.factor),
      })) as ConversionRule[];
    },
    enabled: !!estId,
    staleTime: 30 * 60 * 1000, // Reference data — rarely changes
  });

  const unitsQuery = useQuery({
    queryKey: ["measurement-units-with-family", estId],
    queryFn: async (): Promise<UnitWithFamily[]> => {
      if (!estId) return [];
      const { data, error } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation, category, family, is_reference, aliases")
        .eq("establishment_id", estId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as UnitWithFamily[];
    },
    enabled: !!estId,
    staleTime: 30 * 60 * 1000, // Reference data — rarely changes
  });

  return {
    conversions: conversionsQuery.data ?? [],
    units: unitsQuery.data ?? [],
    isLoading: conversionsQuery.isLoading || unitsQuery.isLoading,
  };
}
