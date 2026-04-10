/**
 * Analyse Facture Engine
 *
 * Ce moteur travaille EN MÉMOIRE uniquement.
 * Il ne fait AUCUN appel à Vision AI.
 * Il compare les données extraites avec les produits/factures existants.
 */

import {
  AnalysisResult,
  AnalysisAlert,
  AlertLevel,
  AlertCode,
  ExtractionSettings,
  ExistingProduct,
  InvoiceRecord,
  AnalysisInput,
} from "../types";
import { detectDuplicateInvoice } from "./detectDuplicateInvoice";
import { filterExistingProducts } from "./filterExistingProducts";
import { normalizeProductNameV2 as normalizeProductName } from "@/modules/produitsV2";

interface AnalyzeOptions {
  input: AnalysisInput;
  settings: ExtractionSettings;
  existingProducts: ExistingProduct[];
  existingInvoices: InvoiceRecord[];
}

/**
 * Main analysis function
 * Receives extracted data and performs all comparisons/calculations
 */
export function analyzeExtraction(options: AnalyzeOptions): AnalysisResult {
  const { input, settings, existingProducts, existingInvoices } = options;
  const { items, invoiceNumber, invoiceDate, invoiceTotal, supplierId, itemsCount } = input;

  const alerts: AnalysisAlert[] = [];
  let filteredItems = [...items];
  let filteredOutCount = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. DÉTECTION FACTURE DÉJÀ IMPORTÉE (ROBUSTE - 3 STRATEGIES)
  // ═══════════════════════════════════════════════════════════════════════════
  const duplicateResult = detectDuplicateInvoice({
    supplierId,
    invoiceNumber,
    invoiceDate,
    invoiceTotal,
    itemsCount,
    existingInvoices,
  });

  // Only generate alert if check was performed AND duplicate found
  if (
    duplicateResult.status === "checked" &&
    duplicateResult.isDuplicate === true &&
    duplicateResult.reason
  ) {
    const codeMap: Record<string, AlertCode> = {
      exact_match: "INVOICE_DUPLICATE_EXACT",
      robust_match: "INVOICE_DUPLICATE_ROBUST",
      fuzzy_match: "INVOICE_DUPLICATE_FUZZY",
    };

    alerts.push(
      createAlert("blocking", codeMap[duplicateResult.reason], {
        message: "Cette facture semble déjà importée",
        details: duplicateResult.explanation ?? undefined,
        data: {
          invoiceId: duplicateResult.existingInvoice?.id,
          reason: duplicateResult.reason,
        },
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECK: NO EXPLOITABLE LINES (BLOCKING)
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.length === 0) {
    alerts.push(
      createAlert("blocking", "NO_EXPLOITABLE_LINES", {
        message: "Aucune ligne exploitable dans cette facture",
        details: "Le document ne contient aucun produit identifiable.",
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. FILTRAGE PRODUITS DÉJÀ EXISTANTS (PRIORITY: code_produit > name)
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings.filter_existing_products && items.length > 0) {
    const filterResult = filterExistingProducts(items, existingProducts);
    filteredItems = filterResult.filteredItems;
    filteredOutCount = filterResult.filteredOutCount;

    if (filteredOutCount > 0) {
      alerts.push(
        createAlert("info", "PRODUCTS_FILTERED", {
          message: `${filteredOutCount} produit${filteredOutCount > 1 ? "s" : ""} déjà enregistré${filteredOutCount > 1 ? "s" : ""} masqué${filteredOutCount > 1 ? "s" : ""}`,
          details: "Ces produits existent déjà dans votre base.",
          data: { count: filteredOutCount },
        })
      );
    }

    // Debug mode: log each filtered product
    if (settings.show_existing_products_debug) {
      filterResult.existingItems.forEach((item, idx) => {
        alerts.push(
          createAlert("info", "PRODUCT_ALREADY_EXISTS", {
            message: `Produit existant: ${item.nom_produit_complet}`,
            productIndex: idx,
          })
        );
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. VARIATION DE PRIX
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings.price_variation_enabled) {
    filteredItems.forEach((item, index) => {
      if (item.prix_total_ligne === null) return;

      // Find matching existing product
      const normalized = normalizeProductName(item.nom_produit_complet);
      const existingProduct = existingProducts.find(
        (p) => p.name_normalized.toLowerCase() === normalized
      );

      if (existingProduct?.prix_unitaire) {
        const expectedPrice = existingProduct.prix_unitaire;
        // BIZ-INV-105: Compare unit price vs unit price (not total line price vs unit price).
        // ExtractedProductLine has no prix_unitaire field, so derive it from total / quantity.
        const qty = item.quantite_commandee ?? 1;
        const actualPrice = qty !== 0 ? item.prix_total_ligne / qty : item.prix_total_ligne;
        const variation = Math.abs((actualPrice - expectedPrice) / expectedPrice) * 100;

        if (variation > settings.price_variation_tolerance_pct) {
          const level: AlertLevel = settings.price_variation_blocking ? "blocking" : "warning";
          const code: AlertCode = settings.price_variation_blocking
            ? "PRICE_VARIATION_BLOCKING"
            : "PRICE_VARIATION";

          alerts.push(
            createAlert(level, code, {
              message: `Variation de prix: ${item.nom_produit_complet}`,
              details: `Prix attendu: ${expectedPrice.toFixed(2)}€, Prix actuel: ${actualPrice.toFixed(2)}€ (${variation.toFixed(1)}%)`,
              productIndex: index,
              data: { expectedPrice, actualPrice, variation },
            })
          );
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. QUANTITÉ ANORMALE
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings.abnormal_quantity_enabled) {
    filteredItems.forEach((item, index) => {
      if (item.quantite_commandee === null) return;

      // Simple heuristic: flag quantities > 100 as potentially abnormal
      if (item.quantite_commandee > 100) {
        const level: AlertLevel = settings.abnormal_quantity_blocking ? "blocking" : "warning";
        const code: AlertCode = settings.abnormal_quantity_blocking
          ? "ABNORMAL_QUANTITY_BLOCKING"
          : "ABNORMAL_QUANTITY";

        alerts.push(
          createAlert(level, code, {
            message: `Quantité inhabituelle: ${item.nom_produit_complet}`,
            details: `Quantité commandée: ${item.quantite_commandee}`,
            productIndex: index,
            data: { quantity: item.quantite_commandee },
          })
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PRODUITS RAREMENT ACHETÉS
  // ═══════════════════════════════════════════════════════════════════════════
  // Note: This requires invoice line history which we don't have yet
  // Placeholder for future implementation

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. PRIX MANQUANT
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings.missing_price_enabled) {
    filteredItems.forEach((item, index) => {
      if (item.prix_total_ligne === null) {
        const level: AlertLevel = settings.missing_price_blocking ? "blocking" : "warning";
        const code: AlertCode = settings.missing_price_blocking
          ? "MISSING_PRICE_BLOCKING"
          : "MISSING_PRICE";

        alerts.push(
          createAlert(level, code, {
            message: `Prix manquant: ${item.nom_produit_complet}`,
            details: "Le prix n'a pas pu être extrait pour ce produit.",
            productIndex: index,
          })
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. FACTURE ATYPIQUE
  // ═══════════════════════════════════════════════════════════════════════════
  if (settings.atypical_invoice_enabled) {
    if (items.length === 1) {
      alerts.push(
        createAlert("info", "ATYPICAL_INVOICE", {
          message: "Facture atypique détectée",
          details: "Cette facture ne contient qu'un seul produit.",
        })
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD RESULT
  // ═══════════════════════════════════════════════════════════════════════════
  const blockingAlerts = alerts.filter((a) => a.level === "blocking");
  const warnings = alerts.filter((a) => a.level === "warning");
  const infoAlerts = alerts.filter((a) => a.level === "info");

  return {
    items,
    filteredItems,
    filteredOutCount,
    alerts,
    blockingAlerts,
    warnings,
    infoAlerts,
    isBlocked: blockingAlerts.length > 0,
    duplicateResult,
    settings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function createAlert(
  level: AlertLevel,
  code: AlertCode,
  options: Omit<AnalysisAlert, "id" | "level" | "code">
): AnalysisAlert {
  return {
    id: `${code}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    level,
    code,
    ...options,
  };
}
