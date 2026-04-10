/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BL-APP — Types (V1)
 * Couche documentaire isolée. Aucune dépendance stock/ledger/factures.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type BlAppStatus = "DRAFT" | "FINAL" | "VOIDED";

export interface BlAppDocument {
  id: string;
  establishment_id: string;
  stock_document_id: string;
  supplier_id: string | null;
  supplier_name_snapshot: string | null;
  bl_number: string | null;
  bl_date: string; // ISO date (YYYY-MM-DD)
  status: BlAppStatus;
  created_by: string | null;
  created_at: string;
  /** Resolved via profiles join — name of the user who created the BL */
  created_by_name: string | null;
  updated_at: string;
  completed_at: string | null;
  /** Computed at fetch time: true if at least one file attached */
  has_files?: boolean;
}

export interface BlAppLine {
  id: string;
  establishment_id: string;
  bl_app_document_id: string;
  product_id: string;
  quantity_canonical: number;
  canonical_unit_id: string;
  context_hash: string | null;
  unit_price: number | null;
  line_total: number | null;
  created_at: string;
}

export interface BlAppFile {
  id: string;
  establishment_id: string;
  bl_app_document_id: string;
  storage_path: string;
  mime_type: string | null;
  original_name: string | null;
  created_at: string;
}

/** Payload for creating a BL-APP after POST OK */
export interface CreateBlAppPayload {
  establishment_id: string;
  stock_document_id: string;
  supplier_id: string | null;
  supplier_name_snapshot: string | null;
  bl_date: string;
  created_by: string;
  lines: CreateBlAppLinePayload[];
}

export interface CreateBlAppLinePayload {
  product_id: string;
  quantity_canonical: number;
  canonical_unit_id: string;
  context_hash: string | null;
}

/** Payload for completing BL-APP via popup */
export interface CompleteBlAppPayload {
  bl_number: string | null;
  status: "FINAL";
  completed_at: string;
}
