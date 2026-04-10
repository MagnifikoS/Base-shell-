/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTUALISATION INVENTAIRE — Types (module-local, no external dependency)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Minimal product shape needed by the suggestion engine (read-only). */
export interface MutualisableProduct {
  id: string;
  nom_produit: string;
  category_id: string | null;
  stock_handling_unit_id: string | null;
  storage_zone_id: string | null;
  supplier_name: string | null;
}

/** A suggested group of similar products, before human validation. */
export interface SuggestedGroup {
  /** Display name derived from the shared kernel */
  displayName: string;
  /** All product IDs in the suggestion */
  productIds: string[];
  /** Products with their names for UI display */
  products: Array<{ id: string; nom_produit: string; supplier_name: string | null }>;
}

/** A persisted group (from DB). */
export interface MutualisationGroup {
  id: string;
  display_name: string;
  carrier_product_id: string;
  establishment_id: string;
  is_active: boolean;
  created_at: string;
  /** B2B billing unit (resolved by mutualisation orchestrator) */
  b2b_billing_unit_id: string | null;
  /** B2B unified price in billing unit */
  b2b_unit_price: number | null;
  /** Price strategy used: carrier, average, manual, cheapest, most_expensive */
  b2b_price_strategy: string | null;
  members: Array<{
    id: string;
    product_id: string;
    product_name?: string;
  }>;
}
