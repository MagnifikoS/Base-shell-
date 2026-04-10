/**
 * B2B Catalogue Import — Shared types
 */

// ── Catalogue source data (from fn_get_b2b_catalogue) ──

export interface B2BCatalogProduct {
  id: string;
  nom_produit: string;
  code_produit: string | null;
  category_id: string | null;
  category_name: string | null;
  final_unit_price: number | null;
  conditionnement_config: Record<string, unknown> | null;
  conditionnement_resume: string | null;
  final_unit_id: string | null;
  supplier_billing_unit_id: string | null;
  supplier_billing_quantity: number | null;
  supplier_billing_line_total: number | null;
  delivery_unit_id: string | null;
  stock_handling_unit_id: string | null;
  kitchen_unit_id: string | null;
  price_display_unit_id: string | null;
  min_stock_unit_id: string | null;
  min_stock_quantity_canonical: number | null;
  allow_unit_sale?: boolean;
}

export interface B2BSupplierUnit {
  id: string;
  name: string;
  abbreviation: string;
  family: string | null;
  category: string;
  is_reference: boolean;
  aliases: string[] | null;
}

export interface B2BCatalogResponse {
  ok: boolean;
  error?: string;
  products?: B2BCatalogProduct[];
  supplier_units?: B2BSupplierUnit[];
  supplier_establishment_id?: string;
}

// ── Unit mapping ──

export type UnitMappingStatus = "MAPPED" | "UNKNOWN" | "AMBIGUOUS";

export interface UnitMappingResult {
  sourceUnitId: string;
  sourceUnit: { name: string; abbreviation: string; family: string | null };
  status: UnitMappingStatus;
  localUnitId: string | null;
  candidates: string[];
}

// ── Category mapping ──

export type CategoryMappingStatus = "MAPPED" | "NOT_FOUND" | "NULL_OK";

export interface CategoryMappingResult {
  sourceCategoryId: string | null;
  sourceCategoryName: string | null;
  status: CategoryMappingStatus;
  localCategoryId: string | null;
  localCategoryName: string | null;
}

// ── Local unit (client-side) ──

export interface LocalUnit {
  id: string;
  name: string;
  abbreviation: string;
  family: string | null;
  category: string;
  is_reference: boolean;
  aliases: string[] | null;
}

// ── Local category (client-side) ──

export interface LocalCategory {
  id: string;
  name: string;
  name_normalized: string | null;
  is_archived: boolean;
}

// ── Import statuses ──

export type ImportProductStatus =
  | "ELIGIBLE"
  | "ALREADY_IMPORTED"
  | "BLOCKED_UNIT_UNKNOWN"
  | "BLOCKED_UNIT_AMBIGUOUS"
  | "BLOCKED_UNIT_FAMILY_MISMATCH"
  | "BLOCKED_CATEGORY"
  | "BLOCKED_VALIDATION_WIZARD"
  | "BLOCKED_NAME_COLLISION"
  | "IMPORTED"
  | "ERROR";

export interface ImportProductResult {
  sourceProductId: string;
  nom_produit: string;
  status: ImportProductStatus;
  reason?: string;
  localProductId?: string;
}

// ── Enriched catalog product (after mapping analysis) ──

export interface EnrichedCatalogProduct extends B2BCatalogProduct {
  importStatus: ImportProductStatus;
  blockReason?: string;
  unitMappings: UnitMappingResult[];
  categoryMapping: CategoryMappingResult;
}
