/**
 * Types for the Agent IA module.
 * Phase 1: extraction-only, no persistence.
 */

/** Placeholder — types will be added in later steps */
export interface AgentIAModule {
  readonly _brand: "agentIA";
}

/** TVA source provenance */
export type TvaSource =
  | "explicite_validee"
  | "calculee"
  | "suggeree_par_categorie"
  | "corrigee_utilisateur"
  | null;

/** Extracted product with TVA fields */
export interface ProduitExtraitTva {
  tva_rate: number | null;
  tva_source: TvaSource;
}

/** Root-level anomaly flag */
export interface AgentExtractionResult {
  anomalie_total_ttc: boolean;
}
