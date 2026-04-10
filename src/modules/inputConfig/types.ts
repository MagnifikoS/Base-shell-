/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE INPUT CONFIG — TYPES
 * ═══════════════════════════════════════════════════════════════════════════
 * Isolated module for product quantity input configuration.
 * NOT connected to any existing modal.
 *
 * ARCHITECTURE CONTRACT:
 * - preferred_unit_id = SUGGESTION only, validated at runtime against the engine
 * - level_* booleans removed — the engine decides which levels to show
 * - ProductNature captures the full physical truth without resolving units
 */

export type InputMode = "continuous" | "decimal" | "integer" | "fraction" | "multi_level";

export type ConfigStatus = "not_configured" | "configured" | "needs_review" | "error";

export type UnitNature = "continuous" | "discrete";

/**
 * Product nature classification — captures the full physical truth
 * of a product's structure for config purposes.
 *
 * PURPOSE: UX labels, default suggestions, display hints.
 * NOT FOR: validation, status computation, mode authorization.
 *
 * - continuous_pure: final unit is weight/volume, no discrete dimension
 * - discrete_pure: final unit is count, no continuous equivalence
 * - hybrid_discrete_continuous: final unit is count BUT a weight/volume
 *   equivalence exists (e.g. Aubergine: 1 pièce = 350g)
 * - variable_weight: billed by weight but managed in discrete packaging
 *   (e.g. supplier_billing_unit is kg but stock_handling is "Sachet")
 */
export type ProductNature =
  | "continuous_pure"
  | "discrete_pure"
  | "hybrid_discrete_continuous"
  | "variable_weight";

export interface ProductInputConfigRow {
  id: string;
  product_id: string;
  establishment_id: string;
  reception_mode: InputMode;
  /** SUGGESTION only — must be validated against resolveProductUnitContext at runtime */
  reception_preferred_unit_id: string | null;
  /** Ordered unit chain for multi_level mode. null when mode !== "multi_level". */
  reception_unit_chain: string[] | null;
  internal_mode: InputMode;
  /** SUGGESTION only — must be validated against resolveProductUnitContext at runtime */
  internal_preferred_unit_id: string | null;
  /** Ordered unit chain for multi_level mode. null when mode !== "multi_level". */
  internal_unit_chain: string[] | null;
  /** Purchase (external supplier) mode — always L0, independent of B2B toggle */
  purchase_mode: InputMode;
  /** Purchase preferred unit — always L0 packaging unit */
  purchase_preferred_unit_id: string | null;
  /** Purchase unit chain — always null (no multi-level for external purchases) */
  purchase_unit_chain: string[] | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Pre-computed auto-config payload for mono-unit products.
 * null = product has multiple exploitable units (needs manual config).
 * Computed from BFS engine choices — NOT a new source of truth.
 */
export interface AutoConfigPayload {
  reception_mode: InputMode;
  reception_preferred_unit_id: string;
  internal_mode: InputMode;
  internal_preferred_unit_id: string;
}

/** Enriched product row used in the config list view */
export interface ProductForConfig {
  id: string;
  nom_produit: string;
  /** Resolved label from final_unit_id (UUID → measurement_units.name). No legacy text. */
  final_unit: string | null;
  final_unit_id: string | null;
  unit_family: UnitNature;
  /** Full product nature classification (hybrid, variable weight, etc.) */
  product_nature: ProductNature;
  packaging_levels_count: number;
  packaging_levels: Array<{
    id: string;
    type: string;
    type_unit_id?: string | null;
    containsQuantity: number | null;
    containsUnit: string;
    contains_unit_id?: string | null;
  }>;
  /** True if an equivalence exists in conditionnement_config */
  has_equivalence: boolean;
  /** Family of the equivalence target unit (if any) */
  equivalence_target_family: UnitNature | null;
  /** Human-readable label of the equivalence target unit (e.g. "kg", "L") */
  equivalence_label: string | null;
  /** Equivalence display string, e.g. "1 pièce ≈ 350 g" */
  equivalence_display: string | null;
  /** True if supplier billing unit differs from final unit family */
  has_supplier_context: boolean;
  config: ProductInputConfigRow | null;
  /** Global status (worst of reception + internal) */
  status: ConfigStatus;
  /** Per-context statuses for independent badge display */
  reception_status: ConfigStatus;
  internal_status: ConfigStatus;

  // ── Engine-facing fields (for resolveProductUnitContext) ──
  /** Raw stock_handling_unit_id from products_v2 */
  stock_handling_unit_id: string | null;
  /** Raw supplier_billing_unit_id from products_v2 */
  supplier_billing_unit_id: string | null;
  /** Raw delivery_unit_id from products_v2 */
  delivery_unit_id: string | null;
  /** Raw conditionnement_config JSON for the engine */
  conditionnement_config_raw: Record<string, unknown> | null;

  /**
   * Pre-computed auto-config payload for mono-unit products.
   * null = not auto-configurable (multiple units or multi-level possible).
   * Computed from BFS engine — same source of truth as manual config.
   */
  autoConfigPayload: AutoConfigPayload | null;
}

/** Payload for bulk upsert */
export interface BulkConfigPayload {
  reception_mode: InputMode;
  reception_preferred_unit_id: string | null;
  reception_unit_chain: string[] | null;
  internal_mode: InputMode;
  internal_preferred_unit_id: string | null;
  internal_unit_chain: string[] | null;
}

/** Filter state for the list view */
export interface InputConfigFilters {
  search: string;
  unitFamily: "all" | "continuous" | "discrete";
  levelsCount: "all" | "0" | "1" | "2+";
  status: "all" | ConfigStatus;
}

/** Mode labels for display */
export const MODE_LABELS: Record<InputMode, string> = {
  continuous: "Stepper (+/-)",
  decimal: "Saisie libre",
  integer: "Entier",
  fraction: "Fraction (¼, ½, ¾)",
  multi_level: "Multi-niveaux",
};

/** Nature labels for display */
export const NATURE_LABELS: Record<ProductNature, string> = {
  continuous_pure: "Continu",
  discrete_pure: "Discret",
  hybrid_discrete_continuous: "Hybride",
  variable_weight: "Poids variable",
};
