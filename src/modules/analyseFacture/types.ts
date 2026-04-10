/**
 * Module Analyse Facture - Types
 * 
 * Ce module est SÉPARÉ de Vision AI.
 * Il reçoit les données extraites et effectue les calculs/comparaisons.
 */

import { ExtractedProductLine } from "../visionAI/types";

// ═══════════════════════════════════════════════════════════════════════════
// ALERT LEVELS (INVARIANT UX)
// ═══════════════════════════════════════════════════════════════════════════

export type AlertLevel = "blocking" | "warning" | "info";

export interface AnalysisAlert {
  id: string;
  level: AlertLevel;
  code: AlertCode;
  message: string;
  details?: string;
  productIndex?: number; // Index in the extracted items array
  data?: Record<string, unknown>;
}

export type AlertCode =
  // 🔴 BLOCKING
  | "INVOICE_DUPLICATE_EXACT"      // supplier_id + invoice_number
  | "INVOICE_DUPLICATE_ROBUST"     // supplier_id + date + total
  | "INVOICE_DUPLICATE_FUZZY"      // supplier_id + date + ~total + ~items_count
  | "NO_EXPLOITABLE_LINES"
  | "MISSING_PRICE_BLOCKING"
  | "PRICE_VARIATION_BLOCKING"
  | "ABNORMAL_QUANTITY_BLOCKING"
  // 🟠 WARNING
  | "PRICE_VARIATION"
  | "ABNORMAL_QUANTITY"
  | "MISSING_PRICE"
  // 🔵 INFO
  | "PRODUCT_ALREADY_EXISTS"
  | "PRODUCTS_FILTERED"
  | "RARELY_BOUGHT"
  | "ATYPICAL_INVOICE";

// ═══════════════════════════════════════════════════════════════════════════
// DUPLICATE DETECTION RESULT
// ═══════════════════════════════════════════════════════════════════════════

export type DuplicateReason = 
  | "exact_match"      // supplier_id + invoice_number
  | "robust_match"     // supplier_id + date + total
  | "fuzzy_match";     // supplier_id + date + ~total + ~items_count

/**
 * Status du check doublon
 * - "not_checked" : supplierId non validé, check impossible
 * - "checked" : supplierId validé, check effectué
 */
export type DuplicateCheckStatus = "not_checked" | "checked";

export interface DuplicateInvoiceResult {
  /** Status du check (not_checked si supplierId null) */
  status: DuplicateCheckStatus;
  /** true si doublon détecté, false si pas de doublon, null si non vérifié */
  isDuplicate: boolean | null;
  reason: DuplicateReason | null;
  existingInvoice: InvoiceRecord | null;
  explanation: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION SETTINGS (FROM DB)
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractionSettings {
  id: string;
  organization_id: string;
  establishment_id: string;
  
  // 2. Filtrage produits existants
  filter_existing_products: boolean;
  show_existing_products_debug: boolean;
  
  // 3. Variation de prix
  price_variation_enabled: boolean;
  price_variation_tolerance_pct: number;
  price_variation_blocking: boolean;
  
  // 4. Quantité anormale
  abnormal_quantity_enabled: boolean;
  abnormal_quantity_tolerance_pct: number;
  abnormal_quantity_blocking: boolean;
  
  // 5. Produits rarement achetés
  rarely_bought_enabled: boolean;
  rarely_bought_threshold_count: number;
  rarely_bought_period_months: number;
  
  // 6. Prix manquant
  missing_price_enabled: boolean;
  missing_price_blocking: boolean;
  
  // 7. Facture atypique
  atypical_invoice_enabled: boolean;
}

export const DEFAULT_EXTRACTION_SETTINGS: Omit<ExtractionSettings, "id" | "organization_id" | "establishment_id"> = {
  filter_existing_products: true,
  show_existing_products_debug: false,
  price_variation_enabled: true,
  price_variation_tolerance_pct: 10,
  price_variation_blocking: false,
  abnormal_quantity_enabled: true,
  abnormal_quantity_tolerance_pct: 30,
  abnormal_quantity_blocking: false,
  rarely_bought_enabled: true,
  rarely_bought_threshold_count: 2,
  rarely_bought_period_months: 3,
  missing_price_enabled: true,
  missing_price_blocking: true,
  atypical_invoice_enabled: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS RESULT
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisResult {
  /** Original extracted items */
  items: ExtractedProductLine[];
  
  /** Filtered items (after removing existing products if enabled) */
  filteredItems: ExtractedProductLine[];
  
  /** Count of items that were filtered out (already exist in SSOT) */
  filteredOutCount: number;
  
  /** All generated alerts */
  alerts: AnalysisAlert[];
  
  /** Quick access to blocking alerts */
  blockingAlerts: AnalysisAlert[];
  
  /** Quick access to warnings */
  warnings: AnalysisAlert[];
  
  /** Quick access to info alerts */
  infoAlerts: AnalysisAlert[];
  
  /** Is validation blocked? */
  isBlocked: boolean;
  
  /** Duplicate invoice detection result */
  duplicateResult: DuplicateInvoiceResult;
  
  /** Settings used for this analysis */
  settings: ExtractionSettings;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXISTING PRODUCT (from SSOT)
// ═══════════════════════════════════════════════════════════════════════════

export interface ExistingProduct {
  id: string;
  code_produit: string | null;
  nom_produit: string;
  name_normalized: string;
  prix_unitaire: number | null;
  conditionnement: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVOICE HISTORY (for duplicate detection) — ENRICHED
// ═══════════════════════════════════════════════════════════════════════════

export interface InvoiceRecord {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  supplier_id: string;
  amount_eur: number;
  /** Number of line items (for fuzzy matching) */
  items_count?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS INPUT
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisInput {
  items: ExtractedProductLine[];
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
  /** Validated supplier_id (from SupplierMatchField) */
  supplierId: string | null;
  /** Items count from extraction */
  itemsCount: number;
}
