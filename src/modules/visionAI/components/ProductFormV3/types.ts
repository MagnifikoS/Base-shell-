/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT FORM V3 — TYPES (NIZAR B)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 5 étapes métier:
 * 1. Structure du produit (unité ref + poids fixe/variable + équivalence)
 * 2. Conditionnement fournisseur (packaging multi-niveaux)
 * 3. Facturation (unité facturée + quantité + prix)
 * 4. Gestion (inventaire / cuisine / prix display)
 * 5. Résumé intelligent
 */

import type { PackagingLevel, PriceLevel } from "@/modules/conditionnementV2";

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface ProductV3InitialData {
  nom_produit: string;
  quantite_commandee: number | null;
  prix_total_ligne: number | null;
  unite_facturee: string | null;
  /** UUID de l'unité facturée (pré-remplissage édition) */
  unite_facturee_id?: string | null;
  code_produit: string | null;
  info_produit: string | null;
  vai_category?: string | null;
  /** SSOT: UUID → product_categories.id (pré-remplissage édition) */
  vai_category_id?: string | null;

  // ── Step 4 — Gestion (pré-remplissage édition) ──
  delivery_unit_id?: string | null;
  stock_handling_unit_id?: string | null;
  kitchen_unit_id?: string | null;
  price_display_unit_id?: string | null;

  // ── Step 5 — Stock & Classification (pré-remplissage édition) ──
  storage_zone_id?: string | null;
  min_stock_quantity_canonical?: number | null;
  min_stock_unit_id?: string | null;
  barcode?: string | null;

  // ── UX metadata: raw billing input (faithful wizard reopening) ──
  supplier_billing_quantity?: number | null;
  supplier_billing_line_total?: number | null;

  // ── DLC alert threshold (product-level override) ──
  dlc_warning_days?: number | null;

  // ── Optimistic lock (for atomic wizard save) ──
  updated_at?: string | null;
  // ── Supplier Unit V1 ──
  allow_unit_sale?: boolean;
}

/**
 * État complet du wizard V3 — Nizar B
 *
 * RÈGLE SSOT: Chaque unité est stockée sous 2 formes :
 * - texte (pour le moteur de calcul V2)
 * - UUID (*_id) (pour la persistance SSOT dans products_v2)
 */
export interface WizardState {
  currentStep: WizardStep;

  // ÉTAPE 1 — Identité produit
  productName: string;
  productCode: string;
  identitySupplierId: string | null;

  // ÉTAPE 2 — Structure du produit
  finalUnit: string | null;
  finalUnitId: string | null;

  // ÉTAPE 2 — Conditionnement fournisseur
  hasPackaging: boolean;
  packagingLevels: PackagingLevel[];

  // ÉTAPE 3 — Facturation
  billedQuantity: string;
  billedUnit: string;
  billedUnitId: string | null;
  lineTotal: string;
  priceLevel: PriceLevel | null;

  // ÉTAPE 3 — Facturation (+ prix display)
  deliveryUnitId: string | null;
  stockHandlingUnitId: string | null;
  priceDisplayUnitId: string | null;

  // ÉTAPE 5 — Zone & Stock initial
  /** @deprecated Nom textuel — garder pour affichage, SSOT = categoryId */
  category: string;
  /** SSOT: UUID → product_categories.id */
  categoryId: string | null;
  storageZoneId: string | null;
  minStockQuantity: string;
  minStockUnitId: string | null;
  initialStockQuantity: string;
  initialStockUnitId: string | null;
  barcode: string;
  /** DLC alert threshold override (product-level, in days). Empty string = inherit */
  dlcWarningDays: string;

  // ── Input config (saisie réception + interne) ──
  inputConfigReceptionMode: import("@/modules/inputConfig").InputMode | null;
  inputConfigReceptionUnitId: string | null;
  inputConfigReceptionChain: string[] | null;
  inputConfigReceptionPartial: boolean;
  inputConfigInternalMode: import("@/modules/inputConfig").InputMode | null;
  inputConfigInternalUnitId: string | null;
  inputConfigInternalChain: string[] | null;
  inputConfigInternalPartial: boolean;

  // ── Supplier Unit V1: toggle for B2B unit sale ──
  allowUnitSale: boolean;

}

export interface PriceLevelOption {
  value: string;
  label: string;
  priceLevel: PriceLevel;
}

export interface ProductFormV3ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData: ProductV3InitialData | null;
  supplierName?: string | null;
  existingConditionnementConfig?: import("@/modules/produitsV2/types").ConditioningConfig | null;
}
