/**
 * BL Retrait — Delivery note for withdrawals (reporting document only).
 * Linked to a WITHDRAWAL stock_document. Does NOT create stock events.
 * Prices are frozen snapshots at generation time.
 */

export interface BlRetrait {
  id: string;
  establishment_id: string;
  organization_id: string;
  stock_document_id: string;
  bl_number: string;
  destination_establishment_id: string | null;
  destination_name: string | null;
  total_amount: number | null;
  status: "FINAL";
  created_by: string | null;
  created_at: string;
}

export interface BlRetraitLine {
  id: string;
  bl_retrait_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_label: string | null;
  unit_price: number | null;
  line_total: number | null;
  created_at: string;
}

/** Payload for creating a BL Retrait after withdrawal POST */
export interface CreateBlRetraitPayload {
  establishment_id: string;
  organization_id: string;
  stock_document_id: string;
  destination_establishment_id: string | null;
  destination_name: string | null;
  created_by: string;
  lines: CreateBlRetraitLinePayload[];
}

export interface CreateBlRetraitLinePayload {
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_label: string | null;
  canonical_unit_id?: string | null;
  unit_price: number | null;
}
