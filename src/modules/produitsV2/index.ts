/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUITS V2 — Module Index (Public API)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Pages
export { default as ProduitsV2ListPage } from "./pages/ProduitsV2ListPage";
export { default as ProduitV2DetailPage } from "./pages/ProduitV2DetailPage";

// Components
export { ProductV2Header } from "./components/ProductV2Header";
export { ProductsV2Table } from "./components/ProductsV2Table";
export { ProductsV2GroupedBySupplier } from "./components/ProductsV2GroupedBySupplier";
export { ProductV2ConfigSummary } from "./components/ProductV2ConfigSummary";
export { ProductConditionnementEditButton } from "./components/ProductConditionnementEditButton";
export { MinStockCard } from "./components/MinStockCard";
export { ProductUnitsTable } from "./components/ProductUnitsTable";
export { EligibilityBanner } from "./components/EligibilityBanner";

// Hooks
export { useProductsV2 } from "./hooks/useProductsV2";
export { useProductV2 } from "./hooks/useProductV2";
export { useProductV2Mutations } from "./hooks/useProductV2Mutations";
export { useProductCategories } from "./hooks/useProductCategories";
export { useStorageZones } from "./hooks/useStorageZones";
export type { StorageZone } from "./hooks/useStorageZones";
export { useSuppliersList } from "./hooks/useSuppliersList";
export type { SupplierOption } from "./hooks/useSuppliersList";
export { useMinStockSave } from "./hooks/useMinStockSave";

// Services (for V3 integration + inventaire)
export {
  createOrUpdateProductV2,
  checkProductV2Collision,
  updateProductV2,
  patchWizardFields,
} from "./services/productsV2Service";

// Price display (used by inventaire drawer)
export { resolveDisplayPrice } from "./services/priceDisplayResolver";
export type {
  PriceDisplayProduct,
  PriceDisplayResult,
  PriceDisplayOption,
} from "./services/priceDisplayResolver";

// Types
export type {
  ProductV2,
  ProductV2ListItem,
  ProductV2FormData,
  ProductV2Filters,
  ConditioningConfig,
  CreateProductV2Payload,
  UpdateProductV2Payload,
  CollisionCheckResult,
} from "./types";

// Utils
export { normalizeProductNameV2 } from "./utils/normalizeProductName";
export {
  isProductInventoryEligible,
  ELIGIBILITY_REASON_LABELS,
} from "./utils/isProductInventoryEligible";
export type {
  EligibilityReason,
  EligibilityResult,
  EligibilityProductInput,
} from "./utils/isProductInventoryEligible";
