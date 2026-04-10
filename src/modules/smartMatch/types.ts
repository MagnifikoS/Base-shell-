/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART_MATCH — Types (Contrat unique)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Module isolé et supprimable : rm -rf src/modules/smartMatch/
 * SSOT produit : products_v2
 * Apprentissage : supplier_product_aliases + brain_rules
 */

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST
// ═══════════════════════════════════════════════════════════════════════════

export interface SmartMatchRequest {
  establishment_id: string;
  supplier_id: string;
  raw_label: string;
  code_produit?: string | null;
  code_barres?: string | null;
  unit_of_sale?: string | null;
  packaging?: string | null;
  category_suggestion?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

export type MatchReason =
  | "code_barres"
  | "code_produit"
  | "alias"
  | "name_exact"
  | "fuzzy"
  | "unit_boost"
  | "category_boost"
  | "brain_boost";

export interface SmartMatchCandidate {
  product_id: string;
  nom_produit: string;
  name_normalized: string;
  code_produit: string | null;
  code_barres: string | null;
  category: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_resume: string | null;
  confidence: number; // 0–1
  reasons: MatchReason[];
}

export interface SmartMatchResponse {
  /** Best match if confidence very high (auto-select hint) */
  bestMatch: SmartMatchCandidate | null;
  /** Top candidates sorted by confidence desc */
  candidates: SmartMatchCandidate[];
  /** UI hint: true if bestMatch confidence >= 1 and from exact source */
  autoSelectRecommended: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARN (post-validation humaine)
// ═══════════════════════════════════════════════════════════════════════════

export interface SmartMatchLearnParams {
  establishment_id: string;
  supplier_id: string;
  raw_label: string;
  code_produit?: string | null;
  /** The product_id from products_v2 confirmed by the human */
  confirmed_product_id: string;
  /** How: confirmed existing, corrected, or created new */
  action: "confirmed" | "corrected" | "created";
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL — Lightweight product row for engine
// ═══════════════════════════════════════════════════════════════════════════

export interface SmartMatchProductRow {
  id: string;
  nom_produit: string;
  name_normalized: string;
  code_produit: string | null;
  code_barres: string | null;
  category: string | null;
  supplier_billing_unit_id: string | null;
  conditionnement_resume: string | null;
}

export interface SmartMatchAliasRow {
  global_product_id: string;
  normalized_key: string;
  supplier_product_code: string | null;
}
