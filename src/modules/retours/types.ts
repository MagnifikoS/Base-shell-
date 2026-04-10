/**
 * Types for the Retours module — isolated, no external dependency.
 *
 * IMPORTANT: Les retours sont des SIGNALEMENTS DÉCLARATIFS.
 * - Ils n'impactent PAS le stock, les litiges, ni les commandes
 * - product_id "00000000-..." = produit hors commande (déclaratif, pas un identifiant métier)
 * - product_name_snapshot préfixé "[Hors commande]" pour les produits non commandés
 * - Ne jamais utiliser ces données pour des calculs, totaux, ou exports métier
 */

export type ReturnType =
  | "mauvais_produit"
  | "produit_en_plus"
  | "produit_casse"
  | "dlc_depassee"
  | "dlc_trop_proche"
  | "non_conforme";

export type ReturnStatus = "pending" | "accepted" | "refused";

export type ReturnResolution = "avoir" | "remplacement" | "retour_physique";

export interface ProductReturn {
  id: string;
  commande_id: string;
  commande_line_id: string | null;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  canonical_unit_id: string | null;
  unit_label_snapshot: string | null;
  return_type: ReturnType;
  reason_comment: string | null;
  client_establishment_id: string;
  supplier_establishment_id: string;
  status: ReturnStatus;
  resolution: ReturnResolution | null;
  supplier_comment: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProductReturnPhoto {
  id: string;
  return_id: string;
  storage_path: string;
  original_name: string | null;
  created_at: string;
}

export const RETURN_TYPE_LABELS: Record<ReturnType, string> = {
  mauvais_produit: "Mauvais produit",
  produit_en_plus: "Produit en plus (non commandé)",
  produit_casse: "Produit cassé / abîmé",
  dlc_depassee: "DLC dépassée",
  dlc_trop_proche: "DLC trop proche",
  non_conforme: "Produit non conforme",
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  pending: "En attente",
  accepted: "Accepté",
  refused: "Refusé",
};

export const RETURN_RESOLUTION_LABELS: Record<ReturnResolution, string> = {
  avoir: "Avoir à faire",
  remplacement: "Remplacement produit",
  retour_physique: "Retour physique demandé",
};
