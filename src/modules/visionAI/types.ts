/**
 * Vision AI Module Types
 * Isolated types for units and packaging formats.
 *
 * NOTE: ExtractedProductLine and CategorySuggestion are now defined in
 * @/modules/shared/extractionTypes and re-exported here for backward compatibility.
 */

// Re-export shared types (SSOT is now in shared module)
export type { ExtractedProductLine, CategorySuggestion } from "@/modules/shared";

export interface MeasurementUnit {
  id: string;
  name: string;
  abbreviation: string;
  aliases: string[] | null;
  category: string;
  is_active: boolean;
  is_system: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  establishment_id: string;
  organization_id: string;
  /** Role/usage category: supplier, stock, recipe, reference */
  usage_category?: string | null;
  /** Unit family: weight, volume, count */
  family?: string | null;
  /** Free-text notes */
  notes?: string | null;
}

export interface PackagingFormat {
  id: string;
  label: string;
  unit_id: string;
  quantity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  establishment_id: string;
  organization_id: string;
}

export interface MeasurementUnitFormData {
  name: string;
  abbreviation: string;
  aliases: string;
  is_active: boolean;
}

export interface PackagingFormatFormData {
  label: string;
  unit_id: string;
  quantity: number;
  is_active: boolean;
}

/**
 * Invoice data - 4 fields extracted (supplier_name added)
 */
export interface InvoiceData {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
}

/**
 * Insight - label/value pair for "Infos comprises"
 */
export interface Insight {
  label: string;
  value: string;
}

/**
 * Response from vision-ai-extract edge function (ENRICHED V1)
 */
export interface ExtractionResponse {
  success: boolean;
  invoice: InvoiceData;
  items: import("@/modules/shared/extractionTypes").ExtractedProductLine[];
  insights: Insight[];
  error?: string;
}
