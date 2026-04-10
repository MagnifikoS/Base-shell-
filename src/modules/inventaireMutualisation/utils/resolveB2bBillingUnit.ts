/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION — B2B Billing Unit Resolver (Pure Orchestrator)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Determines the B2B billing unit for a mutualisation group.
 *
 * RULES:
 * 1. If all members share the same PACKAGING SIGNATURE (backend-computed)
 *    → billing unit = that shared packaging type unit
 * 2. Otherwise → billing unit = commercial standard for the canonical family
 *    (weight → kg, volume → L, count → pce)
 *
 * CONSTRAINTS:
 * - NO conversion logic — zero computation of quantities or factors
 * - NO reading of conditionnement_config — uses backend RPC only
 * - NO dependency on other modules except types
 * - Packaging signature comes from fn_get_packaging_signature (SQL)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────

/** Minimal product data needed for billing unit resolution (DB fields only) */
export interface ProductForBillingResolution {
  id: string;
  nom_produit: string;
  stock_handling_unit_id: string;
  final_unit_id: string;
  final_unit_price: number | null;
  /** DB-normalized field — the unit the supplier bills in */
  supplier_billing_unit_id: string | null;
}

/** Unit info from measurement_units table */
export interface UnitInfo {
  id: string;
  name: string;
  family: string;
  abbreviation: string;
}

/** Packaging signature returned by fn_get_packaging_signature (SQL) */
export interface PackagingSignature {
  packaging_type_unit_id: string | null;
  contains_quantity: number | null;
  contains_unit_id: string | null;
}

/** Result of billing unit resolution */
export interface BillingUnitResolution {
  /** Resolved billing unit ID */
  billingUnitId: string;
  /** Human-readable unit name */
  billingUnitName: string;
  /** Why this unit was chosen */
  reason: "shared_packaging" | "commercial_standard";
  /** Canonical family of the group */
  canonicalFamily: string;
}

// ── Commercial standard mapping ──────────────────────────────────────────

const COMMERCIAL_STANDARD_NAMES: Record<string, string> = {
  weight: "Kilogramme",
  volume: "Litre",
  count: "Pièce",
};

// ── Fetch packaging signatures from backend ──────────────────────────────

/**
 * Fetch packaging signatures for a list of products using the SQL function.
 * This is the ONLY way to get packaging info — no client-side parsing.
 */
async function fetchPackagingSignatures(
  productIds: string[]
): Promise<Map<string, PackagingSignature | null>> {
  const results = new Map<string, PackagingSignature | null>();

  // Call the SQL function for each product (batched via Promise.all)
  const calls = productIds.map(async (id) => {
    const { data, error } = await supabase.rpc("fn_get_packaging_signature", {
      p_product_id: id,
    });
    if (error || data === null) {
      results.set(id, null);
    } else {
      results.set(id, data as unknown as PackagingSignature);
    }
  });

  await Promise.all(calls);
  return results;
}

// ── Core resolver ────────────────────────────────────────────────────────

/**
 * Resolve the B2B billing unit for a set of products in a mutualisation group.
 *
 * Uses backend-computed packaging signatures (fn_get_packaging_signature)
 * to determine if all members share the same physical packaging.
 *
 * ZERO local computation — no quantity multiplication, no conversion factors,
 * no reading of conditionnement_config.
 *
 * @param products - Member products (DB fields only)
 * @param allUnits - All measurement_units available (for lookup)
 * @returns Resolution result or null if products are incompatible
 */
export async function resolveB2bBillingUnit(
  products: ProductForBillingResolution[],
  allUnits: UnitInfo[]
): Promise<BillingUnitResolution | null> {
  if (products.length === 0) return null;

  // ── 1. Determine canonical family ──────────────────────────────────
  const canonicalUnitId = products[0].stock_handling_unit_id;
  const canonicalUnit = allUnits.find((u) => u.id === canonicalUnitId);
  if (!canonicalUnit) return null;

  const canonicalFamily = canonicalUnit.family;

  // All members must share the same canonical family
  const allSameFamily = products.every((p) => {
    const u = allUnits.find((unit) => unit.id === p.stock_handling_unit_id);
    return u?.family === canonicalFamily;
  });
  if (!allSameFamily) return null;

  // ── 2. Fetch packaging signatures from backend ─────────────────────
  const signatures = await fetchPackagingSignatures(products.map((p) => p.id));

  // Check if all products have valid signatures
  const allSignatures = products.map((p) => signatures.get(p.id));
  const allHaveSignatures = allSignatures.every(
    (s): s is PackagingSignature =>
      s !== null &&
      s !== undefined &&
      s.packaging_type_unit_id !== null &&
      s.contains_quantity !== null &&
      s.contains_unit_id !== null
  );

  if (allHaveSignatures) {
    const validSignatures = allSignatures as PackagingSignature[];
    const first = validSignatures[0];

    // Compare all signatures: same type + same quantity + same contained unit
    const allSamePackaging = validSignatures.every(
      (s) =>
        s.packaging_type_unit_id === first.packaging_type_unit_id &&
        s.contains_quantity === first.contains_quantity &&
        s.contains_unit_id === first.contains_unit_id
    );

    if (allSamePackaging && first.packaging_type_unit_id) {
      // All members share the same packaging → use packaging type unit
      const packagingUnit = allUnits.find(
        (u) => u.id === first.packaging_type_unit_id
      );
      if (packagingUnit) {
        return {
          billingUnitId: packagingUnit.id,
          billingUnitName: packagingUnit.name,
          reason: "shared_packaging",
          canonicalFamily,
        };
      }
    }
  }

  // ── 3. Fallback to commercial standard ─────────────────────────────
  const standardName = COMMERCIAL_STANDARD_NAMES[canonicalFamily];
  if (!standardName) return null;

  const standardUnit = allUnits.find(
    (u) => u.name === standardName && u.family === canonicalFamily
  );
  if (!standardUnit) return null;

  return {
    billingUnitId: standardUnit.id,
    billingUnitName: standardUnit.name,
    reason: "commercial_standard",
    canonicalFamily,
  };
}
