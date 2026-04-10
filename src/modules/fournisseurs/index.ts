/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE FOURNISSEURS V1 - Entry Point
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT for supplier management. All supplier data flows through this module.
 *
 * RULES:
 * - Suppliers are scoped by establishment_id
 * - Uniqueness enforced on (establishment_id, name_normalized)
 * - Soft delete only (archived_at)
 * - Human validation required for all creation/modification
 */

// Components
export { FournisseursPage } from "./pages/FournisseursPage";
export { SupplierDetailPage } from "./pages/SupplierDetailPage";
export { SupplierCreatePage } from "./pages/SupplierCreatePage";

// Hooks
export { useSuppliers } from "./hooks/useSuppliers";
export { useSupplierMatch } from "./hooks/useSupplierMatch";

// Services
export {
  createSupplier,
  updateSupplier,
  archiveSupplier,
  getSupplierById,
  type SupplierInput,
  type Supplier,
} from "./services/supplierService";

// Utils
export {
  normalizeSupplierName,
  normalizeForComparison,
  normalizeStrictForExactMatch,
  normalizeLooseForFuzzyMatch,
} from "./utils/normalizeSupplierName";
export {
  computeSupplierMatch,
  recomputeMatch,
  type SupplierMatchResult,
  type SupplierSuggestion,
} from "./utils/supplierMatcher";
