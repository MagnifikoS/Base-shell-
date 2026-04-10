/**
 * Types for the Litiges module — isolated, no external dependency.
 */

export type LitigeStatus = "open" | "resolved";

export interface Litige {
  id: string;
  commande_id: string;
  created_by: string;
  status: LitigeStatus;
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface LitigeLine {
  id: string;
  litige_id: string;
  commande_line_id: string;
  shipped_quantity: number;
  received_quantity: number;
  reason: string | null;
  created_at: string;
}

export interface LitigeWithLines extends Litige {
  lines: LitigeLine[];
}
