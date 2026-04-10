/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Types (ISOLATED from V1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLES:
 * - Aucune dépendance vers V1 (produits/)
 * - Types alignés sur la table products_v2
 * - Réutilisation du moteur conditionnementV2 via import
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MIGRATION supplier_id (2026-02-09)
 * ═══════════════════════════════════════════════════════════════════════════
 * - supplier_id = SSOT unique pour l'attribution fournisseur
 * - supplier_name = DEPRECATED (lecture seule, aucune écriture)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Re-export from shared to maintain backward compatibility for consumers
export type { ConditioningConfig } from "@/modules/shared/conditioningTypes";
import type { ConditioningConfig } from "@/modules/shared/conditioningTypes";

// ═══════════════════════════════════════════════════════════════════════════
// DB ROW TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductV2 {
  id: string;
  establishment_id: string;

  // Identification
  code_produit: string | null;
  code_barres: string | null;
  nom_produit: string;
  nom_produit_fr: string | null;
  name_normalized: string;
  variant_format: string | null;

  // Categorization & Supplier
  /** @deprecated LEGACY TEXT — Utiliser category_id */
  category: string | null;
  /** SSOT: UUID FK → product_categories.id */
  category_id: string | null;

  /**
   * SSOT: Unique source de vérité pour l'attribution fournisseur
   * FK vers invoice_suppliers(id)
   */
  supplier_id: string;

  /** SSOT: UUID FK → measurement_units.id — Unité de facturation fournisseur */
  supplier_billing_unit_id: string | null;

  // Conditioning
  conditionnement_config: ConditioningConfig | null;
  conditionnement_resume: string | null;

  // Final pricing
  final_unit_price: number | null;

  /** SSOT: UUID FK → measurement_units.id — Unité interne de référence */
  final_unit_id: string | null;

  /** SSOT: UUID FK → measurement_units.id — Unité de manipulation stock */
  stock_handling_unit_id: string | null;

  /** SSOT: UUID FK → measurement_units.id — Unité cuisine / recette */
  kitchen_unit_id: string | null;

  /** SSOT: UUID FK → measurement_units.id — Unité de livraison physique (carton, colis, pièce…) */
  delivery_unit_id: string | null;

  /** SSOT: UUID FK → measurement_units.id — Unité d'affichage du prix unitaire */
  price_display_unit_id: string | null;

  // Storage zone
  storage_zone_id: string | null;

  // Min stock threshold
  min_stock_quantity_canonical: number | null;
  min_stock_unit_id: string | null;
  min_stock_updated_at: string | null;
  min_stock_updated_by: string | null;

  // DLC alert threshold (product-level override)
  dlc_warning_days: number | null;

  // UX metadata: raw billing input from wizard Step 3 (for faithful reopening)
  supplier_billing_quantity: number | null;
  supplier_billing_line_total: number | null;
  allow_unit_sale: boolean;

  // Additional info
  info_produit: string | null;

  // Audit
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONDITIONING CONFIG (stored as JSONB)
// ═══════════════════════════════════════════════════════════════════════════
// Moved to @/core/unitConversion/types.ts to break circular dependency.
// Re-exported above for backward compatibility.

// ═══════════════════════════════════════════════════════════════════════════
// FORM DATA (for create/update)
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductV2FormData {
  code_produit: string;
  code_barres: string;
  nom_produit: string;
  nom_produit_fr: string;
  variant_format: string;
  category: string;
  /** SSOT: UUID → product_categories.id */
  category_id: string;
  /** SSOT: UUID du fournisseur (invoice_suppliers.id) */
  supplier_id: string;
  /** SSOT: UUID → measurement_units.id */
  supplier_billing_unit_id: string;
  /** SSOT: UUID zone de stockage (storage_zones.id) */
  storage_zone_id: string;
  conditionnement_config: ConditioningConfig | null;
  conditionnement_resume: string;
  final_unit_price: string;
  /** SSOT: UUID → measurement_units.id */
  final_unit_id: string;
  /** SSOT: UUID → measurement_units.id — Unité manipulation stock */
  stock_handling_unit_id: string;
  /** SSOT: UUID → measurement_units.id — Unité cuisine */
  kitchen_unit_id: string;
  /** SSOT: UUID → measurement_units.id — Unité livraison */
  delivery_unit_id: string;
  /** SSOT: UUID → measurement_units.id — Unité affichage prix */
  price_display_unit_id: string;
  info_produit: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIST ITEM (lightweight for table display)
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductV2ListItem {
  id: string;
  code_produit: string | null;
  nom_produit: string;
  nom_produit_fr: string | null;
  final_unit_price: number | null;
  /** @deprecated LEGACY TEXT — Utiliser category_id + category_name */
  category: string | null;
  /** SSOT: UUID → product_categories.id */
  category_id: string | null;
  /** Nom catégorie (via jointure product_categories) — SSOT display */
  category_name: string | null;
  code_barres: string | null;
  /** SSOT: UUID du fournisseur */
  supplier_id: string;
  /** Nom du fournisseur (via jointure invoice_suppliers) */
  supplier_display_name: string;
  conditionnement_resume: string | null;
  /** SSOT: UUID unité de stock (inventaire) */
  stock_handling_unit_id: string | null;
  /** Nom unité inventaire (via jointure measurement_units) */
  stock_handling_unit_name: string | null;
  /** SSOT: UUID zone de stockage */
  storage_zone_id: string | null;
  /** Nom zone (via jointure storage_zones) */
  storage_zone_name: string | null;
  /** SSOT: final_unit_id for conversion fallback */
  final_unit_id: string | null;
  /** UUID supplier_billing_unit_id for conversion */
  supplier_billing_unit_id: string | null;
  /** UUID delivery_unit_id for conversion */
  delivery_unit_id: string | null;
  /** Conditionnement config for BFS */
  conditionnement_config: ConditioningConfig | null;
  /** SSOT: UUID → measurement_units.id — Unité d'affichage du prix */
  price_display_unit_id: string | null;
  /** True if product_input_config has both reception + internal preferred units set */
  has_input_config: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIER INFO (for display)
// ═══════════════════════════════════════════════════════════════════════════

export interface SupplierInfo {
  id: string;
  name: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTERS
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductV2Filters {
  search: string;
  /** @deprecated Filtre par nom texte — préférer categoryId */
  category: string | null;
  /** Filtre par category_id UUID (SSOT) */
  categoryId: string | null;
  /** Filtre par supplier_id (SSOT) — pas par nom */
  supplier: string | null;
  /** Filtre par storage_zone_id (SSOT) */
  storageZone: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE/UPDATE PAYLOAD
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateProductV2Payload {
  establishment_id: string;
  code_produit?: string | null;
  code_barres?: string | null;
  nom_produit: string;
  nom_produit_fr?: string | null;
  name_normalized: string;
  variant_format?: string | null;
  category?: string | null;
  /** SSOT: UUID → product_categories.id */
  category_id?: string | null;
  supplier_id: string;
  supplier_billing_unit_id?: string | null;
  storage_zone_id?: string | null;
  conditionnement_config?: ConditioningConfig | null;
  conditionnement_resume?: string | null;
  final_unit_price?: number | null;
  final_unit_id?: string | null;
  stock_handling_unit_id?: string | null;
  kitchen_unit_id?: string | null;
  delivery_unit_id?: string | null;
  price_display_unit_id?: string | null;
  info_produit?: string | null;
  min_stock_quantity_canonical?: number | null;
  min_stock_unit_id?: string | null;
  initial_stock_quantity?: number | null;
  initial_stock_unit_id?: string | null;
  supplier_billing_quantity?: number | null;
  supplier_billing_line_total?: number | null;
  allow_unit_sale?: boolean;
  dlc_warning_days?: number | null;
  created_by?: string | null;
}

export interface UpdateProductV2Payload {
  code_produit?: string | null;
  code_barres?: string | null;
  nom_produit?: string;
  nom_produit_fr?: string | null;
  name_normalized?: string;
  variant_format?: string | null;
  category?: string | null;
  /** SSOT: UUID → product_categories.id */
  category_id?: string | null;
  supplier_id?: string;
  supplier_billing_unit_id?: string | null;
  storage_zone_id?: string | null;
  conditionnement_config?: ConditioningConfig | null;
  conditionnement_resume?: string | null;
  final_unit_price?: number | null;
  final_unit_id?: string | null;
  stock_handling_unit_id?: string | null;
  kitchen_unit_id?: string | null;
  delivery_unit_id?: string | null;
  price_display_unit_id?: string | null;
  inventory_display_unit_id?: string | null;
  info_produit?: string | null;
  min_stock_quantity_canonical?: number | null;
  min_stock_unit_id?: string | null;
  supplier_billing_quantity?: number | null;
  supplier_billing_line_total?: number | null;
  allow_unit_sale?: boolean;
  dlc_warning_days?: number | null;
  /** F9: Optimistic lock — the updated_at value read by the client. If provided, update will fail if another write happened since. */
  expected_updated_at?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLISION RESULT
// ═══════════════════════════════════════════════════════════════════════════

export interface CollisionCheckResult {
  hasCollision: boolean;
  collisionType: "barcode" | "code_produit" | "name" | null;
  existingProductId: string | null;
  existingProductName: string | null;
}
