/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Hook: get exposed units for a product
 * ═══════════════════════════════════════════════════════════════
 *
 * Returns ONLY the units explicitly exposed by the product's
 * conditioning config (finalUnit + packagingLevels + equivalence).
 * No BFS traversal — strictly what the product proposes.
 *
 * PHYSICAL SIBLINGS (display convenience):
 * If the exposed units contain kg → also offer g, and vice-versa.
 * If the exposed units contain L  → also offer mL, and vice-versa.
 * These siblings are real measurement_units rows from the DB.
 *
 * kitchen_unit_id is used ONLY as a pre-selection hint.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";

export interface ExposedUnit {
  id: string;
  name: string;
  abbreviation: string;
}

interface ProductConditioningRow {
  conditionnement_config: ConditioningConfig | null;
  final_unit_id: string | null;
  kitchen_unit_id: string | null;
}

/**
 * Extract the set of unit UUIDs explicitly defined in the conditioning config.
 */
function extractExposedUnitIds(
  config: ConditioningConfig | null,
  finalUnitId: string | null
): string[] {
  const ids = new Set<string>();

  // 1. Final unit (from column or config)
  if (finalUnitId) ids.add(finalUnitId);
  if (config?.final_unit_id) ids.add(config.final_unit_id);

  // 2. Each packaging level type
  if (config?.packagingLevels) {
    for (const level of config.packagingLevels) {
      if (level.type_unit_id) ids.add(level.type_unit_id);
      if (level.contains_unit_id) ids.add(level.contains_unit_id);
    }
  }

  // 3. Equivalence source
  if (config?.equivalence?.source_unit_id) {
    ids.add(config.equivalence.source_unit_id);
  }
  if (config?.equivalence?.unit_id) {
    ids.add(config.equivalence.unit_id);
  }

  return Array.from(ids);
}

/**
 * Physical sibling pairs: if one is present, offer the other for readability.
 * Keyed by lowercase abbreviation → sibling abbreviation to look up.
 */
const PHYSICAL_SIBLINGS: Record<string, string[]> = {
  kg: ["g"],
  g: ["kg"],
  l: ["ml", "cl"],
  ml: ["l", "cl"],
  cl: ["l", "ml"],
};

export function useProductUnitsForRecipe(productId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  // Fetch product conditioning data — low staleTime to pick up config changes quickly
  const productQuery = useQuery({
    queryKey: ["recipe-product-conditioning", productId],
    queryFn: async (): Promise<ProductConditioningRow | null> => {
      if (!productId) return null;
      const { data, error } = await supabase
        .from("products_v2")
        .select("conditionnement_config, final_unit_id, kitchen_unit_id")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const config = data.conditionnement_config
        ? typeof data.conditionnement_config === "string"
          ? JSON.parse(data.conditionnement_config)
          : data.conditionnement_config
        : null;
      return {
        conditionnement_config: config as ConditioningConfig | null,
        final_unit_id: data.final_unit_id,
        kitchen_unit_id: data.kitchen_unit_id,
      };
    },
    enabled: !!productId,
    staleTime: 30 * 1000, // 30s — pick up conditioning changes fast
    refetchOnMount: "always",
  });

  const exposedIds = useMemo(() => {
    if (!productQuery.data) return [];
    return extractExposedUnitIds(
      productQuery.data.conditionnement_config,
      productQuery.data.final_unit_id
    );
  }, [productQuery.data]);

  // Fetch unit details for exposed IDs + auto-add physical siblings (kg↔g, L↔mL↔cL)
  const unitsQuery = useQuery({
    queryKey: ["recipe-exposed-units", estId, exposedIds],
    queryFn: async (): Promise<ExposedUnit[]> => {
      if (exposedIds.length === 0) return [];

      // 1. Fetch explicitly exposed units
      const { data: baseUnits, error } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation")
        .in("id", exposedIds);
      if (error) throw error;
      const units = (baseUnits ?? []) as ExposedUnit[];

      // 2. Determine which physical siblings are missing
      const presentAbbrs = new Set(units.map((u) => u.abbreviation.toLowerCase()));
      const presentIds = new Set(units.map((u) => u.id));
      const missingSiblingAbbrs = new Set<string>();

      for (const u of units) {
        const siblings = PHYSICAL_SIBLINGS[u.abbreviation.toLowerCase()];
        if (siblings) {
          for (const sib of siblings) {
            if (!presentAbbrs.has(sib)) {
              missingSiblingAbbrs.add(sib);
            }
          }
        }
      }

      if (missingSiblingAbbrs.size === 0) return units;

      // 3. Fetch siblings from measurement_units (real DB entries)
      const { data: siblingUnits, error: sibErr } = await supabase
        .from("measurement_units")
        .select("id, name, abbreviation")
        .in("abbreviation", Array.from(missingSiblingAbbrs));
      if (sibErr) throw sibErr;

      for (const s of siblingUnits ?? []) {
        if (!presentIds.has(s.id)) {
          units.push(s as ExposedUnit);
        }
      }

      return units;
    },
    enabled: exposedIds.length > 0,
    staleTime: 30 * 1000, // 30s — match product query freshness
  });

  // Pre-select hint: kitchen_unit_id if it's among exposed units
  const defaultUnitId = useMemo(() => {
    const kitchenId = productQuery.data?.kitchen_unit_id;
    const units = unitsQuery.data ?? [];
    if (kitchenId && units.some((u) => u.id === kitchenId)) {
      return kitchenId;
    }
    return units.length > 0 ? units[0].id : null;
  }, [productQuery.data, unitsQuery.data]);

  return {
    exposedUnits: unitsQuery.data ?? [],
    defaultUnitId,
    isLoading: productQuery.isLoading || unitsQuery.isLoading,
  };
}
