/**
 * DLC V0 — Types for the isolated DLC tracking module.
 * SSOT: reception_lot_dlc table stores DLC per received commande line.
 */

export interface ReceptionLotDlc {
  id: string;
  commande_line_id: string;
  establishment_id: string;
  product_id: string;
  dlc_date: string; // ISO date string (YYYY-MM-DD)
  quantity_received: number;
  canonical_unit_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DlcStatus = "ok" | "warning" | "expired";

/** Default fallback for dlc_warning_days when not set on product */
export const DLC_DEFAULT_WARNING_DAYS = 3;

/** Input for upserting a DLC record */
export interface DlcUpsertInput {
  commande_line_id: string;
  establishment_id: string;
  product_id: string;
  dlc_date: string; // YYYY-MM-DD
  quantity_received: number;
  canonical_unit_id: string;
}
