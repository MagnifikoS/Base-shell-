/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Plugin: Product Matching (Phase 2 + Phase 3)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Plugin isolé pour logger les décisions humaines sur le matching produit.
 * 
 * RÈGLES:
 * - Append-only (jamais update)
 * - Fire-and-forget (jamais await, jamais bloquant)
 * - NE PAS logger les auto-match (pas d'action humaine)
 * - Logger UNIQUEMENT les actions humaines explicites
 * 
 * PHASE 2: confirmed, created
 * PHASE 3: corrected (remplacement d'un produit déjà associé)
 * 
 * SUPPRESSION:
 * - Supprimer ce fichier
 * - Retirer les imports dans ExtractedProductsModal.tsx et ProductFormV3Modal.tsx
 * - Retirer l'export dans index.ts
 * - L'app fonctionne identique
 * 
 * @see src/modules/theBrain/README.md
 */

import { brainSafeLog, upsertProductMatchingRule } from "../services/theBrainService";
import { BRAIN_SUBJECTS, BRAIN_ACTIONS } from "../constants";
import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ProductMatchStrategy = "fuzzy" | "manual_select" | "code" | "name_exact" | "supplier_only";

export interface ProductMatchConfirmedParams {
  establishmentId: string;
  supplierId?: string | null;
  lineId: string;
  extracted: {
    code_produit?: string | null;
    nom_produit?: string | null;
    category?: string | null; // Phase 4: Pour context_key
  };
  selected: {
    product_id: string;
    product_code?: string | null;
  };
  strategy: ProductMatchStrategy;
}

export interface ProductMatchCorrectedParams {
  establishmentId: string;
  supplierId?: string | null;
  lineId: string;
  extracted: {
    code_produit?: string | null;
    nom_produit?: string | null;
    category?: string | null; // Phase 4: Pour context_key
  };
  previous: {
    product_id: string;
    product_code?: string | null;
  };
  selected: {
    product_id: string;
    product_code?: string | null;
  };
}

export interface ProductCreatedParams {
  establishmentId: string;
  supplierId?: string | null;
  lineId?: string | null;
  extracted: {
    code_produit?: string | null;
    nom_produit?: string | null;
    category?: string | null; // Phase 4: Pour context_key
  };
  createdProductId: string;
}

/**
 * PLAN B: Sélection via recherche "supplier-only" (sans filtre catégorie)
 * Utilisé quand la catégorie extraite par l'IA est incorrecte
 */
export interface ProductMatchSupplierOnlyParams {
  establishmentId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  lineId: string;
  extracted: {
    code_produit?: string | null;
    nom_produit?: string | null;
    category?: string | null; // Catégorie (incorrecte) extraite par l'IA
  };
  selected: {
    product_id: string;
    product_code?: string | null;
    product_name?: string | null;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS (internes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Récupère le user_id de façon non-bloquante
 * Retourne null si non disponible (ne casse jamais)
 */
async function getUserIdSafe(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log une confirmation de produit (action humaine)
 * 
 * Appelé quand l'utilisateur :
 * - Confirme un fuzzy match (clic "Confirmer")
 * - Sélectionne un produit existant dans les suggestions
 * 
 * ⚠️ NE PAS appeler pour les auto-match 🟢
 * ⚠️ NE PAS appeler si c'est un remplacement (utiliser logProductMatchCorrected)
 */
export function logProductMatchConfirmed(params: ProductMatchConfirmedParams): void {
  // Fire-and-forget : on récupère le userId puis on log
  getUserIdSafe().then((userId) => {
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.PRODUCT_MATCHING,
      action: BRAIN_ACTIONS.CONFIRMED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId ?? null,
        line_id: params.lineId,
        extracted_code_produit: params.extracted.code_produit ?? null,
        extracted_nom_produit: params.extracted.nom_produit ?? null,
        selected_product_id: params.selected.product_id,
        selected_product_code: params.selected.product_code ?? null,
        strategy: params.strategy,
        source: "vision_ai",
      },
    });
    
    // PHASE 4: Upsert rule (fire-and-forget)
    if (params.extracted.nom_produit) {
      upsertProductMatchingRule({
        establishmentId: params.establishmentId,
        supplierId: params.supplierId,
        category: params.extracted.category,
        label: params.extracted.nom_produit,
        productId: params.selected.product_id,
        action: "confirmed",
      });
    }
  });
}

/**
 * Log un remplacement de produit (action humaine - Phase 3)
 * 
 * Appelé quand l'utilisateur :
 * - Change le produit associé à une ligne déjà matchée manuellement
 * - Ex: avait confirmé A, puis choisit B
 * 
 * ⚠️ NE PAS appeler pour la première association (utiliser logProductMatchConfirmed)
 * ⚠️ NE PAS appeler si previous.product_id === selected.product_id (pas de changement)
 */
export function logProductMatchCorrected(params: ProductMatchCorrectedParams): void {
  // Fire-and-forget
  getUserIdSafe().then((userId) => {
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.PRODUCT_MATCHING,
      action: BRAIN_ACTIONS.CORRECTED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId ?? null,
        line_id: params.lineId,
        extracted_code_produit: params.extracted.code_produit ?? null,
        extracted_nom_produit: params.extracted.nom_produit ?? null,
        previous_product_id: params.previous.product_id,
        previous_product_code: params.previous.product_code ?? null,
        selected_product_id: params.selected.product_id,
        selected_product_code: params.selected.product_code ?? null,
        reason: "user_replaced_match",
        source: "vision_ai",
      },
    });
    
    // PHASE 4: Upsert rule avec action corrected (fire-and-forget)
    if (params.extracted.nom_produit) {
      upsertProductMatchingRule({
        establishmentId: params.establishmentId,
        supplierId: params.supplierId,
        category: params.extracted.category,
        label: params.extracted.nom_produit,
        productId: params.selected.product_id,
        action: "corrected",
      });
    }
  });
}

/**
 * Log une création de produit depuis une facture (action humaine)
 * 
 * Appelé quand l'utilisateur :
 * - Complète le Wizard V3 avec succès (upsert réussi)
 * 
 * ⚠️ NE PAS appeler si l'utilisateur ferme sans valider
 */
export function logProductCreatedFromInvoice(params: ProductCreatedParams): void {
  // Fire-and-forget
  getUserIdSafe().then((userId) => {
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.PRODUCT_MATCHING,
      action: BRAIN_ACTIONS.CREATED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId ?? null,
        line_id: params.lineId ?? null,
        extracted_code_produit: params.extracted.code_produit ?? null,
        extracted_nom_produit: params.extracted.nom_produit ?? null,
        created_product_id: params.createdProductId,
        source: "vision_ai",
      },
    });
    
    // PHASE 4: Upsert rule avec action created (fire-and-forget)
    if (params.extracted.nom_produit) {
      upsertProductMatchingRule({
        establishmentId: params.establishmentId,
        supplierId: params.supplierId,
        category: params.extracted.category,
        label: params.extracted.nom_produit,
        productId: params.createdProductId,
        action: "created",
      });
    }
  });
}

/**
 * Log une sélection "supplier-only" (action humaine - PLAN B)
 * 
 * Appelé quand l'utilisateur :
 * - Clique "Chercher chez ce fournisseur" (recherche élargie sans filtre catégorie)
 * - Puis sélectionne un produit existant
 * 
 * Ce mode est un "escape hatch" quand l'IA a mal classifié la catégorie.
 * THE BRAIN apprend cette association pour la reproposer la prochaine fois.
 * 
 * ⚠️ NE PAS appeler pour la recherche normale (fournisseur + catégorie)
 * ⚠️ NE PAS appeler si c'est un remplacement (utiliser logProductMatchCorrected)
 */
export function logProductMatchConfirmedSupplierOnly(params: ProductMatchSupplierOnlyParams): void {
  // Fire-and-forget : on récupère le userId puis on log
  getUserIdSafe().then((userId) => {
    brainSafeLog({
      establishmentId: params.establishmentId,
      subject: BRAIN_SUBJECTS.PRODUCT_MATCHING,
      action: BRAIN_ACTIONS.CONFIRMED,
      actorUserId: userId ?? undefined,
      context: {
        supplier_id: params.supplierId ?? null,
        supplier_name: params.supplierName ?? null,
        line_id: params.lineId,
        extracted_code_produit: params.extracted.code_produit ?? null,
        extracted_nom_produit: params.extracted.nom_produit ?? null,
        extracted_category_incorrect: params.extracted.category ?? null, // Catégorie incorrecte pour diagnostic
        selected_product_id: params.selected.product_id,
        selected_product_code: params.selected.product_code ?? null,
        selected_product_name: params.selected.product_name ?? null,
        strategy: "supplier_only" as ProductMatchStrategy,
        source: "supplier_only_search", // ✅ Discriminant clé
        reason: "category_mismatch_escape_hatch", // String fixe
      },
    });
    
    // PHASE 4: Upsert rule (fire-and-forget)
    // ⚠️ On passe category = null pour que THE BRAIN apprenne "ce libellé → ce produit" 
    // indépendamment de la catégorie incorrecte extraite
    if (params.extracted.nom_produit) {
      upsertProductMatchingRule({
        establishmentId: params.establishmentId,
        supplierId: params.supplierId,
        category: null, // Ignore la catégorie incorrecte
        label: params.extracted.nom_produit,
        productId: params.selected.product_id,
        action: "confirmed",
      });
    }
  });
}
