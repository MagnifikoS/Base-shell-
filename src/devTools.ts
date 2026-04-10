/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV TOOLS — Browser console utilities for headless product operations
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exposes helper functions on `window` for use from the browser console
 * or automated scripts. Import this file once from main.tsx.
 */

import { getWizardOptions } from "@/modules/produitsV2/pipeline/getWizardOptions";
import { createProductFromOptions, type CreateProductInput } from "@/modules/produitsV2/pipeline/createProductFromOptions";
import { validateProductCreated, type ProductValidationReport } from "@/modules/produitsV2/pipeline/validateProductCreated";
import type { PipelineResult } from "@/modules/produitsV2/pipeline/createProductPipeline";

// ─────────────────────────────────────────────────────────────────────────────
// TYPE AUGMENTATION
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    getWizardOptions: typeof getWizardOptions;
    createProduct: (input: CreateProductInput) => Promise<PipelineResult>;
    validateProduct: (productId: string, establishmentId: string) => Promise<ProductValidationReport>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

window.getWizardOptions = (establishmentId: string) => {
  return getWizardOptions(establishmentId);
};

window.createProduct = (input: CreateProductInput) => {
  return createProductFromOptions(input);
};

window.validateProduct = async (productId: string, establishmentId: string) => {
  const report = await validateProductCreated(productId, establishmentId);
  console.table(report.checks);
  if (!report.valid) {
    console.error("Produit invalide :", report.errors);
  } else {
    console.log("Produit valide ✅");
  }
  return report;
};

if (import.meta.env.DEV) {
  console.log(
    "[DevTools] Disponible :",
    "window.getWizardOptions(establishmentId),",
    "window.createProduct(input),",
    "window.validateProduct(productId, establishmentId)",
  );
  console.log(
    "[DevTools] RPC atomique disponible :",
    "fn_create_product_complete (PR-14)",
  );
}
