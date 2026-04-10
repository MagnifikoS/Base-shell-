/**
 * Seed hook for Vision AI default data
 *
 * Automatically inserts base measurement units and packaging formats
 * if the establishment has none.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

/**
 * Base measurement units (stock & calculation)
 * These are the canonical units used for inventory, stats, and cost calculations
 */
const BASE_UNITS = [
  { name: "Kilogramme", abbreviation: "kg", category: "base", display_order: 1 },
  { name: "Gramme", abbreviation: "g", category: "base", display_order: 2 },
  { name: "Litre", abbreviation: "L", category: "base", display_order: 3 },
  { name: "Centilitre", abbreviation: "cl", category: "base", display_order: 4 },
  { name: "Millilitre", abbreviation: "ml", category: "base", display_order: 5 },
  { name: "Pièce", abbreviation: "pce", category: "base", display_order: 6 },
  { name: "Unité", abbreviation: "u", category: "base", display_order: 7 },
  { name: "Portion", abbreviation: "port", category: "base", display_order: 8 },
];

/**
 * Packaging/delivery formats
 * These describe how products are delivered and invoiced by suppliers
 */
const PACKAGING_FORMATS = [
  { label: "Carton", quantity: 1 },
  { label: "Pack", quantity: 1 },
  { label: "Colis", quantity: 1 },
  { label: "Caisse", quantity: 1 },
  { label: "Lot", quantity: 1 },
  { label: "Palette", quantity: 1 },
  { label: "Sac", quantity: 1 },
  { label: "Boîte", quantity: 1 },
  { label: "Barquette", quantity: 1 },
  { label: "Bouteille", quantity: 1 },
  { label: "Bidon", quantity: 1 },
  { label: "Fût", quantity: 1 },
];

export function useSeedVisionAIData() {
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();
  const seededRef = useRef(false);

  const establishmentId = activeEstablishment?.id;
  const organizationId = activeEstablishment?.organization_id;

  useEffect(() => {
    if (!establishmentId || !organizationId || seededRef.current) return;

    const seedData = async () => {
      try {
        // Check if units already exist
        const { data: existingUnits, error: unitsError } = await supabase
          .from("measurement_units")
          .select("id")
          .eq("establishment_id", establishmentId)
          .limit(1);

        if (unitsError) throw unitsError;

        // Seed units if none exist
        if (!existingUnits || existingUnits.length === 0) {
          const unitsToInsert = BASE_UNITS.map((unit) => ({
            ...unit,
            establishment_id: establishmentId,
            organization_id: organizationId,
            is_active: true,
            is_system: true,
            aliases: [],
          }));

          const { error: insertUnitsError } = await supabase
            .from("measurement_units")
            .insert(unitsToInsert);

          if (insertUnitsError) throw insertUnitsError;

          // Invalidate to refresh
          queryClient.invalidateQueries({ queryKey: ["measurement-units", establishmentId] });
        }

        // Get the first unit for packaging formats (pièce by default)
        const { data: pieceUnit } = await supabase
          .from("measurement_units")
          .select("id")
          .eq("establishment_id", establishmentId)
          .eq("abbreviation", "pce")
          .limit(1)
          .single();

        const defaultUnitId = pieceUnit?.id;

        // Check if packaging formats already exist
        const { data: existingFormats, error: formatsError } = await supabase
          .from("packaging_formats")
          .select("id")
          .eq("establishment_id", establishmentId)
          .limit(1);

        if (formatsError) throw formatsError;

        // Seed packaging formats if none exist and we have a default unit
        if ((!existingFormats || existingFormats.length === 0) && defaultUnitId) {
          const formatsToInsert = PACKAGING_FORMATS.map((format) => ({
            ...format,
            unit_id: defaultUnitId,
            establishment_id: establishmentId,
            organization_id: organizationId,
            is_active: true,
          }));

          const { error: insertFormatsError } = await supabase
            .from("packaging_formats")
            .insert(formatsToInsert);

          if (insertFormatsError) throw insertFormatsError;

          // Invalidate to refresh
          queryClient.invalidateQueries({ queryKey: ["packaging-formats", establishmentId] });
        }

        seededRef.current = true;
      } catch (error) {
        if (import.meta.env.DEV) console.error("[useSeedVisionAIData] Error seeding data:", error);
      }
    };

    seedData();
  }, [establishmentId, organizationId, queryClient]);
}
