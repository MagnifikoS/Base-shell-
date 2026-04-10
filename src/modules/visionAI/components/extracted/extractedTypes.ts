/**
 * Shared types for extracted products sub-components.
 */

import type { EditableProductLine } from "../../hooks/useBulkProductValidation";

/** Correction de ligne session-only (ne modifie pas products_v2) */
export interface LineCorrection {
  code: string | null;
  name: string;
  /** Ligne marquée comme offerte/gratuite -> prix = 0 */
  isFreeLine?: boolean;
  /** Quantité corrigée manuellement (session-only) */
  quantite?: number | null;
  /** Montant total corrigé manuellement (session-only) */
  montant?: number | null;
}

/** Status returned from useProductStatusV2 for a single item */
export interface ProductStatus {
  status: "validated" | "price_alert" | "needs_action";
  label: string;
  matchResult?: {
    match?: {
      product?: {
        id: string;
        code_produit?: string;
        nom_produit?: string;
      };
    };
  };
  matchedProduct?: {
    id: string;
    code_produit?: string;
    nom_produit?: string;
  };
}

export type { EditableProductLine };
