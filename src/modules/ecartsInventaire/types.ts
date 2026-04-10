/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE: ecartsInventaire — Types
 * ═══════════════════════════════════════════════════════════════
 * Isolated observer module. No modification to StockEngine/Products.
 */

export type DiscrepancyStatus = "open" | "analyzed" | "closed";

export interface InventoryDiscrepancy {
  id: string;
  establishment_id: string;
  organization_id: string;
  product_id: string;
  storage_zone_id: string | null;
  withdrawal_quantity: number;
  estimated_stock_before: number;
  gap_quantity: number;
  canonical_unit_id: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string;
  withdrawal_reason: string | null;
  source_document_id: string | null;
  source_type: string;
  status: DiscrepancyStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Enriched discrepancy with joined product/zone names */
export interface DiscrepancyWithDetails extends InventoryDiscrepancy {
  product_name: string;
  zone_name: string | null;
  unit_label: string | null;
}

/** Params for creating a discrepancy after a withdrawal */
export interface CreateDiscrepancyParams {
  establishmentId: string;
  organizationId: string;
  productId: string;
  storageZoneId: string | null;
  withdrawalQuantity: number;
  estimatedStockBefore: number;
  gapQuantity: number;
  canonicalUnitId: string | null;
  withdrawnBy: string | null;
  withdrawalReason: string | null;
  sourceDocumentId: string | null;
}

/** Investigation data for a discrepancy */
export interface DiscrepancyInvestigation {
  lastReceipt: {
    date: string | null;
    quantity: number | null;
    daysAgo: number | null;
  } | null;
  lastWithdrawal: {
    date: string | null;
    quantity: number | null;
    user: string | null;
    daysAgo: number | null;
  } | null;
  lastInventory: {
    date: string | null;
    quantityCounted: number | null;
    daysAgo: number | null;
  } | null;
  isRecurrent: boolean;
  totalDiscrepancies: number;
}
