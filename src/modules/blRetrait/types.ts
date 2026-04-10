/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-RETRAIT — Types
 * Couche documentaire isolée pour les BL de retrait.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BlRetraitDocument {
  id: string;
  establishment_id: string;
  organization_id: string;
  stock_document_id: string;
  destination_establishment_id: string;
  bl_number: string;
  bl_date: string;
  total_eur: number;
  created_by: string | null;
  created_at: string;
  /** Resolved via profiles join — name of the user who created the BL */
  created_by_name: string | null;
  /** Resolved via FK join — name of the sender establishment */
  source_name: string | null;
  /** Resolved via FK join — name of the destination establishment */
  destination_name: string | null;
  /** "sent" = current est is the sender, "received" = current est is the destination */
  direction: "sent" | "received";
  /** Status of the underlying stock_document: "DRAFT" (in transit), "POSTED" (validated), "VOID" */
  stock_status: "DRAFT" | "POSTED" | "VOID";
}

export interface BlRetraitLine {
  id: string;
  bl_withdrawal_document_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity_canonical: number;
  canonical_unit_id: string;
  unit_price_snapshot: number | null;
  line_total_snapshot: number | null;
  created_at: string;
}

export interface CreateBlRetraitPayload {
  establishment_id: string;
  organization_id: string;
  stock_document_id: string;
  destination_establishment_id: string;
  bl_number: string;
  bl_date: string;
  created_by: string;
}
