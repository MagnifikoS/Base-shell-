/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET WIZARD OPTIONS — Fetches all reference data needed by createProduct (PR-11)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure async function — zero React, zero hooks.
 * Callable from browser console via window.getWizardOptions(establishmentId).
 *
 * Returns suppliers, categories, storage zones, units, and conversions
 * for a given establishment.
 */

import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WizardOptions {
  establishmentId: string;
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  storageZones: {
    id: string;
    name: string;
    name_normalized?: string;
  }[];
  units: {
    id: string;
    name: string;
    abbreviation: string;
    family: string | null;
  }[];
  conversions: {
    from_unit_id: string;
    to_unit_id: string;
    factor: number;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function getWizardOptions(
  establishmentId: string,
): Promise<WizardOptions> {
  if (!establishmentId) {
    throw new Error("establishmentId requis");
  }

  // Run all 5 queries in parallel
  const [suppliersRes, categoriesRes, zonesRes, unitsRes, conversionsRes] =
    await Promise.all([
      // 1. Fournisseurs actifs
      supabase
        .from("invoice_suppliers")
        .select("id, name")
        .eq("establishment_id", establishmentId)
        .is("archived_at", null)
        .order("name", { ascending: true }),

      // 2. Catégories actives
      supabase
        .from("product_categories")
        .select("id, name")
        .eq("establishment_id", establishmentId)
        .eq("is_archived", false)
        .order("name", { ascending: true }),

      // 3. Zones de stockage
      supabase
        .from("storage_zones")
        .select("id, name, name_normalized")
        .eq("establishment_id", establishmentId)
        .order("name", { ascending: true }),

      // 4. Unités de mesure
      supabase
        .from("measurement_units")
        .select("id, name, abbreviation, family")
        .eq("establishment_id", establishmentId)
        .order("name", { ascending: true }),

      // 5. Conversions d'unités
      supabase
        .from("unit_conversions")
        .select("from_unit_id, to_unit_id, factor")
        .eq("establishment_id", establishmentId),
    ]);

  return {
    establishmentId,
    suppliers: suppliersRes.data ?? [],
    categories: categoriesRes.data ?? [],
    storageZones: zonesRes.data ?? [],
    units: unitsRes.data ?? [],
    conversions: conversionsRes.data ?? [],
  };
}
