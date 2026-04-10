/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UNIFIED UNITS HOOK — Single Source of Truth for measurement_units
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces: useInventoryUnits, useConditioningLists (unit part), useMeasurementUnits (read part)
 *
 * This is the ONLY hook that reads measurement_units for display/selection.
 * useMeasurementUnits remains for CRUD operations only (Settings page).
 *
 * Options:
 * - activeOnly (default true): filter is_active
 * - withPackaging (default false): also fetch packaging_formats
 *
 * SSOT Migration 3.2:
 * - resolveUnitId() REMOVED from production exports.
 * - All unit selection must go through Select components that return UUID directly.
 * - No text→ID matching in production code.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

export interface UnitItem {
  id: string;
  name: string;
  abbreviation: string;
  category: string;
  family: string | null;
  is_reference: boolean;
  aliases: string[] | null;
  usage_category: string;
}

export interface PackagingTypeItem {
  id: string;
  name: string;
  abbreviation: string;
}

interface UseUnitsOptions {
  activeOnly?: boolean;
  withPackaging?: boolean;
}

export function useUnits(options: UseUnitsOptions = {}) {
  const { activeOnly = true, withPackaging = false } = options;
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  const query = useQuery({
    queryKey: ["units", estId, activeOnly, withPackaging],
    queryFn: async () => {
      if (!estId) return { units: [], packagingTypes: [] };

      let unitsQuery = supabase
        .from("measurement_units")
        .select("id, name, abbreviation, category, family, is_reference, aliases, usage_category")
        .eq("establishment_id", estId)
        .order("display_order", { ascending: true });

      if (activeOnly) {
        unitsQuery = unitsQuery.eq("is_active", true);
      }

      const { data: unitsData, error: unitsError } = await unitsQuery;
      if (unitsError) throw unitsError;

      // Deduplicate by abbreviation (UI-level, per memory policy)
      const seen = new Set<string>();
      const units = (unitsData ?? []).filter((u) => {
        if (seen.has(u.abbreviation)) return false;
        seen.add(u.abbreviation);
        return true;
      }) as UnitItem[];

      let packagingTypes: PackagingTypeItem[] = [];

      if (withPackaging) {
        // CRITICAL: packaging_formats is NEVER a source of unit IDs.
        // All packaging_formats.unit_id point to a single base unit (e.g. Pièce),
        // NOT to the packaging unit itself (Carton, Caisse, etc.).
        // SSOT: packaging types come 100% from measurement_units where category='packaging'.
        packagingTypes = units
          .filter((u) => u.category === "packaging")
          .map((u) => ({ id: u.id, name: u.name, abbreviation: u.abbreviation }));
      }

      return { units, packagingTypes };
    },
    enabled: !!estId,
    staleTime: 30 * 60 * 1000, // Reference data — rarely changes
  });

  // Derived: base units only (category=base)
  const baseUnits = (query.data?.units ?? []).filter((u) => u.category === "base");

  // Derived: physical units (weight/volume family)
  const physicalUnits = (query.data?.units ?? []).filter(
    (u) => u.family === "weight" || u.family === "volume"
  );

  // Derived: kitchen-eligible units — strict DB-driven (usage_category='kitchen' only)
  const kitchenUnits = (query.data?.units ?? []).filter((u) => u.usage_category === "kitchen");

  return {
    /** All active units (deduplicated) */
    units: query.data?.units ?? [],
    /** Base measurement units only (Pièce, kg, g, L, ml) */
    baseUnits,
    /** Physical units only (weight + volume family from DB) */
    physicalUnits,
    /** Kitchen/recipe eligible units (kitchen category + physical + Pièce) */
    kitchenUnits,
    /** Packaging types (from measurement_units + packaging_formats) */
    packagingTypes: query.data?.packagingTypes ?? [],
    /** Loading state */
    isLoading: query.isLoading,
  };
}
