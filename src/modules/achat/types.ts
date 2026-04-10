/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Types (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Types pour le module Achat.
 * Ce module est en lecture seule — aucun calcul métier ici.
 * 
 * SSOT:
 * - quantite_commandee: valeur brute de purchase_line_items
 * - Unité affichée: resolved via supplier_billing_unit_id (UUID) → measurement_units
 */

/**
 * Ligne d'achat persistée (SSOT Achat)
 */
export interface PurchaseLineItem {
  id: string;
  invoice_id: string;
  establishment_id: string;
  supplier_id: string;
  product_id: string | null;
  year_month: string;
  source_line_id: string;
  quantite_commandee: number | null;
  line_total: number | null;
  product_code_snapshot: string | null;
  product_name_snapshot: string | null;
  unit_snapshot: string | null;
  created_at: string;
}

/**
 * Données pour créer une ligne d'achat
 */
export interface CreatePurchaseLineInput {
  invoice_id: string;
  establishment_id: string;
  supplier_id: string;
  year_month: string;
  source_line_id: string;
  product_id: string | null;
  quantite_commandee: number | null;
  line_total: number | null;
  product_code_snapshot: string | null;
  product_name_snapshot: string | null;
  unit_snapshot: string | null;
}

/**
 * Résultat agrégé pour l'affichage mensuel
 * Jointure avec products_v2 pour obtenir le nom et l'unité SSOT
 */
export interface MonthlyPurchaseSummary {
  product_id: string | null;
  /** Nom du produit (depuis products_v2, fallback sur snapshot si null) */
  product_name: string;
  /** Catégorie (depuis products_v2) */
  category: string | null;
  /** UUID unité fournisseur (products_v2.supplier_billing_unit_id) — SSOT */
  billing_unit_id: string | null;
  /** Label résolu depuis measurement_units (UI-only) */
  billing_unit_label: string | null;
  /** Somme des quantités commandées */
  total_quantity: number | null;
  /** Nombre de factures distinctes */
  invoice_count: number;
  /** Somme des totaux lignes */
  total_amount: number | null;
  /** Snapshot code produit (pour lignes non liées) */
  product_code_snapshot: string | null;
  /** Snapshot unité (pour lignes non liées) */
  unit_snapshot: string | null;
  /** Supplier ID (SSOT) */
  supplier_id: string;
  /** Supplier name (from invoice_suppliers) */
  supplier_name: string;
}

/**
 * Résumé groupé par fournisseur
 */
export interface SupplierPurchaseGroup {
  supplier_id: string;
  supplier_name: string;
  items: MonthlyPurchaseSummary[];
  total_amount: number;
  product_count: number;
}

/**
 * Résultat de l'écriture des lignes Achat
 */
export interface CreatePurchaseLinesResult {
  success: boolean;
  insertedCount: number;
  error?: string;
}
