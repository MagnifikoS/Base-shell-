/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Constantes (Fondation v0)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Sujets et actions autorisés pour le journal d'apprentissage.
 */

/**
 * Flag global pour désactiver THE BRAIN
 * Si true, brainSafeLog ne fait rien
 */
export const THE_BRAIN_DISABLED = false;

/**
 * Sujets autorisés (pour documentation et validation)
 */
export const BRAIN_SUBJECTS = {
  PRODUCT_MATCHING: "product_matching",
  PRICING: "pricing",
  SUPPLIER_MATCHING: "supplier_matching",
  INVENTORY: "inventory",
  PURCHASE_MONITORING: "purchase_monitoring",
  PRICE_EVOLUTION: "price_evolution",
  INVOICE_LIFECYCLE: "invoice_lifecycle",
} as const;

export type BrainSubject = (typeof BRAIN_SUBJECTS)[keyof typeof BRAIN_SUBJECTS];

/**
 * Actions autorisées
 */
export const BRAIN_ACTIONS = {
  CONFIRMED: "confirmed",
  CORRECTED: "corrected",
  IGNORED: "ignored",
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
  OBSERVED: "observed",
  VOIDED: "voided",
} as const;

export type BrainAction = (typeof BRAIN_ACTIONS)[keyof typeof BRAIN_ACTIONS];

/**
 * Labels français pour l'UI
 */
export const SUBJECT_LABELS: Record<string, string> = {
  product_matching: "Matching produits",
  pricing: "Comparaison prix",
  supplier_matching: "Matching fournisseurs",
  inventory: "Inventaire",
  purchase_monitoring: "Monitoring achats",
  price_evolution: "Évolution prix",
  invoice_lifecycle: "Cycle de vie facture",
};

export const ACTION_LABELS: Record<string, string> = {
  confirmed: "Confirmé",
  corrected: "Corrigé",
  ignored: "Ignoré",
  created: "Créé",
  updated: "Modifié",
  deleted: "Supprimé",
  observed: "Observé",
  voided: "Annulée",
};

/**
 * Couleurs pour les actions (design system)
 */
export const ACTION_COLORS: Record<string, string> = {
  confirmed: "text-primary",
  corrected: "text-warning",
  ignored: "text-muted-foreground",
  created: "text-primary",
  updated: "text-warning",
  deleted: "text-destructive",
  observed: "text-muted-foreground",
};
