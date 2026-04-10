/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Types (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Types pour le journal d'apprentissage observable.
 * Module isolé et supprimable.
 */

/**
 * Événement brut dans brain_events
 */
export interface BrainEvent {
  id: string;
  establishment_id: string;
  subject: string;
  action: string;
  context: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}

/**
 * Règle structurée dans brain_rules
 */
export interface BrainRule {
  id: string;
  establishment_id: string;
  subject: string;
  context_key: string;
  value: Record<string, unknown>;
  confirmations_count: number;
  corrections_count: number;
  last_used_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Paramètres pour logger un événement
 */
export interface LogEventParams {
  establishmentId: string;
  subject: string;
  action: string;
  context?: Record<string, unknown>;
  actorUserId?: string;
}

/**
 * Résumé de santé globale
 */
export interface HealthSummary {
  totalEvents: number;
  activeSubjects: number;
  acceptanceRate: number; // confirmed / (confirmed + corrected)
  topSubjects: SubjectSummary[];
}

/**
 * Résumé par sujet
 */
export interface SubjectSummary {
  subject: string;
  eventCount: number;
  confirmedCount: number;
  correctedCount: number;
  acceptanceRate: number;
}

/**
 * Plage de dates pour les requêtes
 */
export type DateRange = "7d" | "30d";

/**
 * Résultat de la requête de santé
 */
export interface BrainHealthData {
  summary: HealthSummary;
  subjects: SubjectSummary[];
  recentEvents: BrainEvent[];
  isLoading: boolean;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE NIVEAU — Types pour la vue "Niveau" (lecture seule)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Statut de confiance d'une règle (UI-only, calculé côté client)
 */
export type RuleConfidenceStatus = "stable" | "probable" | "weak";

/**
 * Règle product_matching enrichie avec le nom produit pour affichage
 */
export interface ProductMatchingRuleDisplay {
  id: string;
  productId: string;
  productName: string;
  contextKey: string;
  confirmationsCount: number;
  correctionsCount: number;
  lastUsedAt: string | null;
  status: RuleConfidenceStatus;
  /** true si supplier_id = "unknown" dans le context_key (règle legacy) */
  isLegacy: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// NIVEAU — Supplier Matching (agrégé depuis brain_events, UI-only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Statut de stabilité d'un matching fournisseur
 */
export type SupplierMatchingStatus = "stable" | "monitoring";

/**
 * Règle supplier_matching agrégée depuis brain_events pour affichage
 * (Lecture seule, calculée côté client)
 */
export interface SupplierMatchingRuleDisplay {
  supplierId: string;
  supplierName: string;
  confirmationsCount: number;
  correctionsCount: number;
  lastUsedAt: string | null;
  status: SupplierMatchingStatus;
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN_RULES — Supplier Matching (Phase: Règles agrégées)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valeur stockée dans brain_rules.value pour supplier_matching
 */
export interface SupplierMatchingRuleValue {
  supplier_id: string;
}

/**
 * Paramètres pour upsert une règle supplier_matching
 */
export interface UpsertSupplierRuleParams {
  establishmentId: string;
  extractedLabel: string; // label OCR brut
  supplierId: string;     // fournisseur confirmé par l'utilisateur
  action: "confirmed" | "corrected";
}

/**
 * Suggestion THE BRAIN pour un fournisseur
 */
export interface BrainSupplierSuggestion {
  supplierId: string;
  confirmationsCount: number;
  correctionsCount: number;
}

/**
 * Paramètres pour récupérer une suggestion fournisseur
 */
export interface GetSupplierSuggestionParams {
  establishmentId: string;
  extractedLabel: string; // label OCR brut
}
