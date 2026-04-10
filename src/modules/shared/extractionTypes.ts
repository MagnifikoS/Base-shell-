/**
 * ===============================================================================
 * SHARED — Extraction Types
 * ===============================================================================
 *
 * Types shared between visionAI and analyseFacture modules.
 * Extracted here to break the circular dependency:
 *
 * BEFORE: analyseFacture -> visionAI (for ExtractedProductLine type)
 *         visionAI -> analyseFacture (for LineStatusResult, etc.)
 *
 * AFTER:  analyseFacture -> shared/extractionTypes
 *         visionAI -> shared/extractionTypes
 *         visionAI -> analyseFacture (one-way, no cycle)
 *
 * ===============================================================================
 */

/**
 * Category suggestion from Vision AI (display only, no DB write)
 */
export interface CategorySuggestion {
  label: string;
  confidence: number;
}

/**
 * Extracted product line from PDF - STRICT 6 fields + optional category suggestion + price_missing flag
 */
export interface ExtractedProductLine {
  code_produit: string | null;
  nom_produit_complet: string;
  /** Infos retirees du nom produit (conditionnement, origine, categorie, etc.) */
  info_produit: string | null;
  quantite_commandee: number | null;
  prix_total_ligne: number | null;
  /**
   * Unite facturee extraite (kg, piece, caisse, carton, etc.)
   * MODELE B: Pour produits matches, cette valeur est IGNOREE pour le calcul.
   * La source de verite est products_v2.supplier_billing_unit.
   * Affichee uniquement comme info de debug / extraction.
   */
  contenu_facture: string | null;
  /** Suggestion de categorie (affichage uniquement, jamais persiste) */
  category_suggestion?: CategorySuggestion;
  /**
   * Flag anti-decalage: true si le prix n'etait pas visible sur cette ligne.
   * Regle: null/undefined = missing (price_missing=true), 0 reste 0 (price_missing=false).
   * Permet a l'UI d'afficher "Prix non fourni / Offert" et de ne pas declencher la logique d'ecart de prix.
   */
  price_missing?: boolean;
  /**
   * Flag LLM: true si la cellule PRIX/MONTANT etait presente sur la ligne
   * false = cellule vide, null = non fourni par l'IA
   */
  has_price_cell?: boolean | null;
}
