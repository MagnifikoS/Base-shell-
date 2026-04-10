/**
 * ProductLineDrawer — Helpers, types, and constants
 *
 * Extracted from ProductLineDrawer.tsx for file size compliance.
 * Contains: EMPTY_FORM, resolveUnitLabel, parseNumeric, types.
 */

import type { ProductV2FormData } from "@/modules/produitsV2";

export const EMPTY_FORM: ProductV2FormData = {
  code_produit: "",
  code_barres: "",
  nom_produit: "",
  nom_produit_fr: "",
  variant_format: "",
  category: "",
  category_id: "",
  supplier_id: "",
  supplier_billing_unit_id: "",
  storage_zone_id: "",
  conditionnement_config: null,
  conditionnement_resume: "",
  final_unit_price: "",
  final_unit_id: "",
  stock_handling_unit_id: "",
  kitchen_unit_id: "",
  delivery_unit_id: "",
  price_display_unit_id: "",
  info_produit: "",
};

/** Resolve unit label from UUID via measurement_units */
export function resolveUnitLabel(
  unitId: string | null | undefined,
  units: Array<{ id: string; name: string; abbreviation: string }>
): string | null {
  if (!unitId) return null;
  const u = units.find((unit) => unit.id === unitId);
  return u ? `${u.name} (${u.abbreviation})` : null;
}

/** Parse a numeric string, allowing comma as decimal separator */
export function parseNumeric(val: string): number | null {
  const trimmed = val.trim();
  if (trimmed === "") return null;
  const parsed = parseFloat(trimmed.replace(",", "."));
  return isNaN(parsed) ? null : parsed;
}
