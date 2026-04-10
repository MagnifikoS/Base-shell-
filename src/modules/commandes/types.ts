/**
 * Types for the Commandes module — isolated, no external dependency.
 */

export type CommandeStatus = "brouillon" | "envoyee" | "ouverte" | "expediee" | "litige" | "recue" | "cloturee";

export type LineStatus = "ok" | "modifie" | "rupture";

export interface Commande {
  id: string;
  client_establishment_id: string;
  supplier_establishment_id: string;
  partnership_id: string;
  status: CommandeStatus;
  note: string | null;
  created_by: string;
  sent_at: string | null;
  opened_at: string | null;
  opened_by: string | null;
  shipped_by: string | null;
  shipped_at: string | null;
  received_by: string | null;
  received_at: string | null;
  reception_type: string | null;
  created_at: string;
  updated_at: string;
  /** Snapshot: creator display name, set at send time (SSOT) */
  created_by_name_snapshot: string | null;
  /** Unique order number, set at send time (SSOT) */
  order_number: string | null;
  /** Link to original commande when this is a complement reorder */
  source_commande_id: string | null;
  /** Resolved display names (populated at list level via RPC) */
  created_by_name?: string | null;
  opened_by_name?: string | null;
  shipped_by_name?: string | null;
  received_by_name?: string | null;
}

export interface CommandeLine {
  id: string;
  commande_id: string;
  product_id: string;
  canonical_quantity: number;
  canonical_unit_id: string;
  product_name_snapshot: string;
  unit_label_snapshot: string | null;
  shipped_quantity: number | null;
  received_quantity: number | null;
  line_status: LineStatus | null;
  /** Prix unitaire figé à l'envoi (SSOT facture) */
  unit_price_snapshot: number | null;
  /** Total ligne figé à l'envoi (SSOT facture) */
  line_total_snapshot: number | null;
  /** Snapshot of user's input intent (presentation layer) */
  input_entries: InputEntrySnapshot[] | null;
  created_at: string;
}

export interface CommandeWithLines extends Commande {
  lines: CommandeLine[];
}

/** Snapshot of the user's input intent — one entry per unit actually entered */
export interface InputEntrySnapshot {
  unit_id: string;
  quantity: number;
  unit_label: string;
}

/** Cart item used in the "Nouvelle commande" flow */
export interface CartItem {
  productId: string;
  productName: string;
  canonicalQuantity: number;
  canonicalUnitId: string;
  canonicalUnitLabel: string | null;
  /** Presentation snapshot of user's input intent (optional for legacy/adjust flows) */
  inputEntries?: InputEntrySnapshot[];
}

/** Line preparation input for shipping */
export interface PreparedLine {
  lineId: string;
  shippedQuantity: number;
  lineStatus: LineStatus;
}

/** Line reception input */
export interface ReceivedLine {
  lineId: string;
  receivedQuantity: number;
}
