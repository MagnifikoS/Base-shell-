/**
 * ===============================================================================
 * SHARED MODULE — Cross-module components and utilities
 * ===============================================================================
 *
 * This module contains components used by multiple business modules.
 * It exists to break circular dependencies between modules.
 *
 * RULE: Only add components here if they are imported by 2+ modules
 * that would otherwise create a circular dependency.
 * ===============================================================================
 */

export { ProductFormV3Modal } from "./ProductFormV3";
export type { ProductV3InitialData, ProductFormV3ModalProps, WizardMode } from "./ProductFormV3";

// Extraction types (shared between visionAI and analyseFacture)
export type { ExtractedProductLine, CategorySuggestion } from "./extractionTypes";

// Month navigation (shared between factures and blApp)
export type { MonthNavigation } from "./monthNavigation";
export { formatYearMonth, getCurrentMonth, toYearMonthString } from "./monthNavigation";

// Post popup types (shared between stockLedger and blApp)
export type { PostPopupProps, PostPopupComponent } from "./postPopupTypes";

// Conditioning config type (shared between core/unitConversion and produitsV2)
export type { ConditioningConfig } from "./conditioningTypes";
