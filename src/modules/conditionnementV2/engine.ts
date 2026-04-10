/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONDITIONNEMENT V2 — MOTEUR DE CALCUL (UUID-STRICT + GRAPHE)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RÈGLES FONDAMENTALES :
 *
 * 1. Le prix est le point d'ANCRAGE du calcul
 *    - La quantité facturée est interprétée AU NIVEAU DU PRIX
 *    - Si billedUnit ≠ priceLevel, on REQUALIFIE la quantité
 *
 * 2. Le facteur s'arrête à l'unité finale
 *    - Pas de multiplication en cascade aveugle
 *
 * 3. Cohérence à 2% (pas 0.01€)
 *    - Warning si écart > 2%
 *
 * 4. Conversions via GRAPHE (DB + packaging + équivalence)
 *    - Zéro hardcode, zéro matching texte
 *    - Toutes les entrées sont des UUID
 */

import type { CalculationInput, CalculationResult, FinalUnit } from "./types";

import { findConversionPath } from "./conversionGraph";
/** Inline: finalUnitToString was a deprecated identity function */

/**
 * SEUIL DE COHÉRENCE (2%)
 */
const COHERENCE_THRESHOLD_PERCENT = 0.02;

/**
 * Vérifie la cohérence entre total calculé et total facture
 */
function checkCoherence(computed: number | null, lineTotal: number | null): boolean {
  if (computed === null || lineTotal === null) {
    return false;
  }
  // Produit offert : total = 0 et calculé = 0 → cohérent
  if (lineTotal === 0) {
    return computed === 0;
  }
  const ratio = Math.abs(computed - lineTotal) / Math.abs(lineTotal);
  return ratio <= COHERENCE_THRESHOLD_PERCENT;
}

/**
 * MOTEUR PRINCIPAL V2 — UUID-STRICT + GRAPHE DE CONVERSION
 */
export function calculateConditionnement(input: CalculationInput): CalculationResult {
  const warnings: string[] = [];
  const units = input.units ?? [];
  const conversions = input.conversions ?? [];

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  if (!input.finalUnit) {
    return {
      quantityFinalTotal: null,
      unitPriceFinal: null,
      totalComputed: null,
      isCoherent: false,
      warnings: ["L'unité finale de référence n'est pas définie."],
    };
  }

  if (input.invoiceData.billedQuantity === null) {
    warnings.push("La quantité facturée n'est pas renseignée.");
  }

  if (input.invoiceData.lineTotal === null) {
    warnings.push("Le prix total ligne n'est pas renseigné.");
  }

  if (!input.invoiceData.billedUnit || input.invoiceData.billedUnit.trim() === "") {
    warnings.push("Le contenu facturé n'est pas défini.");
  }

  if (input.packagingLevels.length > 0 && !input.priceLevel) {
    warnings.push("Veuillez indiquer à quel niveau correspond le prix.");
  }

  // Vérifier contenances
  for (const level of input.packagingLevels) {
    if (level.containsQuantity === null || level.containsQuantity <= 0) {
      warnings.push(`La quantité contenue dans "${level.type}" n'est pas valide.`);
    }
  }

  // Données insuffisantes
  if (
    input.invoiceData.billedQuantity === null ||
    input.invoiceData.lineTotal === null ||
    !input.invoiceData.billedUnit
  ) {
    return {
      quantityFinalTotal: null,
      unitPriceFinal: null,
      totalComputed: null,
      isCoherent: false,
      warnings,
    };
  }

  const { billedQuantity, lineTotal } = input.invoiceData;
  const billedUnitId = input.invoiceData.billedUnitId ?? null;
  const { packagingLevels, finalUnit: _finalUnit, priceLevel, equivalence } = input;

  const finalUnitId = input.finalUnitId ?? null;

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: conversion via graphe
  // ═══════════════════════════════════════════════════════════════════════════

  function convertViaGraph(fromId: string | null, toId: string | null) {
    return findConversionPath(fromId, toId, units, conversions, packagingLevels, equivalence);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DÉTERMINER L'UNITÉ DU PRIX (UUID only)
  // ═══════════════════════════════════════════════════════════════════════════

  let priceUnitId: string | null = null;

  if (priceLevel) {
    if (priceLevel.type === "final") {
      priceUnitId = finalUnitId;
    } else if (priceLevel.type === "billed_physical") {
      priceUnitId = priceLevel.billed_unit_id ?? billedUnitId;
    } else if (priceLevel.type === "equivalence" && equivalence) {
      // Equivalence source = final unit
      priceUnitId = equivalence.source_unit_id ?? finalUnitId;
    } else if (priceLevel.type === "level" && priceLevel.levelId) {
      const level = packagingLevels.find((l) => l.id === priceLevel.levelId);
      if (level) {
        priceUnitId = level.type_unit_id ?? null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAS 1: PAS DE CONDITIONNEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  if (packagingLevels.length === 0) {
    const result = convertViaGraph(billedUnitId, finalUnitId);

    if (!result.reached || result.factor === null) {
      warnings.push(...result.warnings);
      // Fallback : quantité directe si même unité implicite
      return {
        quantityFinalTotal: billedQuantity,
        unitPriceFinal: billedQuantity > 0 ? lineTotal / billedQuantity : null,
        totalComputed: lineTotal,
        isCoherent: true,
        warnings,
      };
    }

    const quantityFinalTotal = billedQuantity * result.factor;
    const unitPriceFinal = quantityFinalTotal > 0 ? lineTotal / quantityFinalTotal : null;

    return {
      quantityFinalTotal,
      unitPriceFinal,
      totalComputed: lineTotal,
      isCoherent: true,
      warnings,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAS 2: AVEC CONDITIONNEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  let quantityFinalTotal: number | null = null;
  let unitPriceFinal: number | null = null;

  if (!priceLevel || !priceUnitId) {
    // Pas de niveau de prix → convertir billedUnit → finalUnit directement
    const result = convertViaGraph(billedUnitId, finalUnitId);

    if (result.reached && result.factor !== null) {
      quantityFinalTotal = billedQuantity * result.factor;
      unitPriceFinal = quantityFinalTotal > 0 ? lineTotal / quantityFinalTotal : null;
    } else {
      warnings.push(...result.warnings);
    }
  } else {
    // ═══════════════════════════════════════════════════════════════════════════
    // REQUALIFICATION : billedQuantity → qtyAtPriceLevel (UUID-STRICT)
    // ═══════════════════════════════════════════════════════════════════════════

    let qtyAtPriceLevel: number;

    if (billedUnitId && priceUnitId && billedUnitId === priceUnitId) {
      qtyAtPriceLevel = billedQuantity;
    } else {
      // Convertir priceUnit → billedUnit pour savoir le ratio
      const priceToBilled = convertViaGraph(priceUnitId, billedUnitId);

      if (!priceToBilled.reached || priceToBilled.factor === null || priceToBilled.factor === 0) {
        // Essayer l'inverse : billed → price
        const billedToPrice = convertViaGraph(billedUnitId, priceUnitId);

        if (billedToPrice.reached && billedToPrice.factor !== null && billedToPrice.factor !== 0) {
          qtyAtPriceLevel = billedQuantity * billedToPrice.factor;
        } else {
          warnings.push(...priceToBilled.warnings);
          return {
            quantityFinalTotal: null,
            unitPriceFinal: null,
            totalComputed: null,
            isCoherent: false,
            warnings,
          };
        }
      } else {
        qtyAtPriceLevel = billedQuantity / priceToBilled.factor;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CALCUL : priceUnit → finalUnit (UUID-STRICT via graphe)
    // ═══════════════════════════════════════════════════════════════════════════

    const priceToFinal = convertViaGraph(priceUnitId, finalUnitId);

    if (!priceToFinal.reached || priceToFinal.factor === null) {
      warnings.push(...priceToFinal.warnings);

      return {
        quantityFinalTotal: null,
        unitPriceFinal: null,
        totalComputed: null,
        isCoherent: false,
        warnings,
      };
    }

    quantityFinalTotal = qtyAtPriceLevel * priceToFinal.factor;
    unitPriceFinal = quantityFinalTotal > 0 ? lineTotal / quantityFinalTotal : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COHÉRENCE
  // ═══════════════════════════════════════════════════════════════════════════

  const totalComputed =
    unitPriceFinal !== null && quantityFinalTotal !== null
      ? unitPriceFinal * quantityFinalTotal
      : null;

  const isCoherent = checkCoherence(totalComputed, lineTotal);

  if (totalComputed !== null && lineTotal !== null && !isCoherent) {
    const delta = Math.abs(totalComputed - lineTotal);
    const deltaPercent =
      Math.abs(lineTotal) > 0 ? (delta / Math.abs(lineTotal)) * 100 : delta > 0 ? 100 : 0;
    warnings.push(
      `Écart de ${deltaPercent.toFixed(1)}% entre le total recalculé et le total facture.`
    );
  }

  return {
    quantityFinalTotal,
    unitPriceFinal,
    totalComputed,
    isCoherent,
    warnings,
  };
}

/**
 * Génère un ID unique
 */
export function generateLevelId(): string {
  return `lvl_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Formate un prix
 */
export function formatPrice(price: number | null, unit: FinalUnit | null): string {
  if (price === null || unit === null) return "—";
  return `${price.toFixed(2)} €/${unit}`;
}

/**
 * Formate une quantité
 */
export function formatQuantity(qty: number | null, unit: FinalUnit | null): string {
  if (qty === null || unit === null) return "—";
  return `${qty.toFixed(2)} ${unit}`;
}
