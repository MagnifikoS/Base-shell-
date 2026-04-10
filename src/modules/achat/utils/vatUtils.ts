/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — VAT Utilities (UI-only, no DB writes)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Calcul TVA à la volée pour affichage uniquement.
 * SSOT reste le prix HT extrait / stocké.
 *
 * Règles:
 * - Fournisseur Cincotti → TVA 0 % (exonéré)
 * - Hygiène / Divers → 20 %
 * - Toutes les autres catégories → 5,5 %
 * - Catégorie inconnue → 0 % + badge "TVA non définie"
 */

/** Catégories soumises à TVA normale (20%) — seules exceptions */
const STANDARD_VAT_CATEGORIES = new Set([
  "divers",
  "hygiène",
]);

/** Fournisseurs exonérés de TVA (nom normalisé) */
const VAT_EXEMPT_SUPPLIERS = new Set([
  "cincotti",
]);

export type VatInfo = {
  /** Taux TVA (0, 0.055, 0.20) */
  rate: number;
  /** Label court */
  label: string;
  /** true si catégorie inconnue → TVA 0% par défaut */
  undefined: boolean;
};

/**
 * Détermine le taux de TVA à partir de la catégorie produit et du fournisseur.
 */
export function getVatInfo(category: string | null, supplierName?: string | null): VatInfo {
  // Fournisseur exonéré → 0 %
  if (supplierName) {
    const normalizedSupplier = supplierName.toLowerCase().trim();
    for (const exempt of VAT_EXEMPT_SUPPLIERS) {
      if (normalizedSupplier.includes(exempt)) {
        return { rate: 0, label: "Exonéré", undefined: false };
      }
    }
  }

  if (!category) {
    return { rate: 0, label: "TVA non définie", undefined: true };
  }

  const normalized = category.toLowerCase().trim();

  // Seules "divers" et "hygiène" → 20 %
  if (STANDARD_VAT_CATEGORIES.has(normalized)) {
    return { rate: 0.20, label: "20 %", undefined: false };
  }

  // Toutes les autres catégories connues → 5,5 %
  return { rate: 0.055, label: "5,5 %", undefined: false };
}

/**
 * Calcule le montant TTC à partir du HT.
 * Arrondi à 2 décimales.
 */
export function computeTTC(amountHT: number | null, category: string | null, supplierName?: string | null): {
  ttc: number | null;
  vat: VatInfo;
} {
  const vat = getVatInfo(category, supplierName);
  if (amountHT === null) return { ttc: null, vat };
  const ttc = Math.round(amountHT * (1 + vat.rate) * 100) / 100;
  return { ttc, vat };
}
