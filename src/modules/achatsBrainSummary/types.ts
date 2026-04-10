/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHATS BRAIN SUMMARY — Types (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Types pour l'UI de synthèse THE BRAIN dans le module Achats.
 * Lecture seule — aucun calcul métier complexe.
 */

/**
 * Données agrégées par produit pour un mois donné
 */
export interface ProductMonthlyAggregate {
  product_id: string | null;
  product_name: string;
  category: string | null;
  /** Resolved from supplier_billing_unit_id → measurement_units.name */
  billing_unit: string | null;
  total_quantity: number;
  total_amount: number | null;
  invoice_count: number;
}

/**
 * Données de comparaison mois vs mois-1
 */
export interface ProductDelta {
  product_id: string | null;
  product_name: string;
  category: string | null;
  current_quantity: number;
  previous_quantity: number;
  delta: number;
  delta_percent: number;
}

/**
 * Résumé mensuel complet pour l'UI
 */
export interface BrainSummaryData {
  yearMonth: string;
  previousYearMonth: string | null;
  
  /** Indicateurs globaux */
  totalDistinctProducts: number;
  totalDistinctSuppliers: number;
  topCategory: string | null;
  totalImports: number;
  
  /** Variation globale vs mois précédent */
  globalDeltaPercent: number | null;
  
  /** Top 5 produits les plus achetés */
  topProducts: ProductMonthlyAggregate[];
  
  /** Top 5 hausses (si mois précédent dispo) */
  topIncreases: ProductDelta[];
  
  /** Top 5 baisses (si mois précédent dispo) */
  topDecreases: ProductDelta[];
  
  /** Catégorie dominante */
  dominantCategory: string | null;
  
  /** Flag si données mois précédent disponibles */
  hasPreviousMonth: boolean;
}

/**
 * Mois disponibles pour le sélecteur
 */
export interface AvailableMonth {
  yearMonth: string;
  label: string;
}
