/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VALIDATE PRODUCT CREATED — Post-creation operational check (PR-13)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Verifies that a product created via the pipeline is fully operational
 * across all flows (reception, withdrawal, inventory, etc.).
 *
 * Zero React, zero hooks, zero side effects.
 */

import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductValidationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ProductValidationReport {
  productId: string;
  valid: boolean;
  checks: ProductValidationCheck[];
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function validateProductCreated(
  productId: string,
  establishmentId: string,
): Promise<ProductValidationReport> {
  const checks: ProductValidationCheck[] = [];
  const errors: string[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // CHECK 1 — Produit existe + stock_handling_unit_id non null
  // ══════════════════════════════════════════════════════════════════════════

  const { data: product, error: productErr } = await supabase
    .from("products_v2")
    .select("id, nom_produit, stock_handling_unit_id, storage_zone_id, final_unit_price")
    .eq("id", productId)
    .is("archived_at", null)
    .maybeSingle();

  if (productErr || !product) {
    checks.push({
      name: "Produit existe",
      passed: false,
      detail: productErr?.message ?? "Produit introuvable",
    });
    errors.push("Produit introuvable en base");
    return { productId, valid: false, checks, errors };
  }

  if (!product.stock_handling_unit_id) {
    checks.push({
      name: "Produit existe",
      passed: false,
      detail: "stock_handling_unit_id est null",
    });
    errors.push("stock_handling_unit_id manquant");
    return { productId, valid: false, checks, errors };
  }

  checks.push({
    name: "Produit existe",
    passed: true,
    detail: product.nom_produit,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CHECK 2 — Config saisie existe et complète
  // ══════════════════════════════════════════════════════════════════════════

  const { data: config, error: configErr } = await supabase
    .from("product_input_config")
    .select("purchase_mode, reception_mode, internal_mode")
    .eq("product_id", productId)
    .eq("establishment_id", establishmentId)
    .maybeSingle();

  if (configErr || !config) {
    checks.push({
      name: "Config saisie existe",
      passed: false,
      detail: configErr?.message ?? "product_input_config absent",
    });
    errors.push("product_input_config absent");
  } else if (!config.purchase_mode || !config.reception_mode || !config.internal_mode) {
    const missing: string[] = [];
    if (!config.purchase_mode) missing.push("purchase_mode");
    if (!config.reception_mode) missing.push("reception_mode");
    if (!config.internal_mode) missing.push("internal_mode");
    checks.push({
      name: "Config saisie existe",
      passed: false,
      detail: `Modes manquants: ${missing.join(", ")}`,
    });
    errors.push(`Config incomplète: ${missing.join(", ")}`);
  } else {
    checks.push({ name: "Config saisie existe", passed: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHECK 3 — Zone de stockage assignée
  // ══════════════════════════════════════════════════════════════════════════

  if (!product.storage_zone_id) {
    checks.push({
      name: "Zone de stockage assignée",
      passed: false,
      detail: "storage_zone_id est null",
    });
    errors.push("Zone de stockage non assignée");
  } else {
    checks.push({ name: "Zone de stockage assignée", passed: true });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHECK 4 — Stock événement (warning only)
  // ══════════════════════════════════════════════════════════════════════════

  const { count: stockEventCount } = await supabase
    .from("stock_events")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((stockEventCount ?? 0) === 0) {
    checks.push({
      name: "Stock événement existe",
      passed: false,
      detail: "Aucun stock_event trouvé (warning)",
    });
    // Warning only — does NOT set valid = false
  } else {
    checks.push({
      name: "Stock événement existe",
      passed: true,
      detail: `${stockEventCount} événement(s)`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHECK 5 — Prix défini (warning only)
  // ══════════════════════════════════════════════════════════════════════════

  if (product.final_unit_price == null) {
    checks.push({
      name: "Prix défini",
      passed: false,
      detail: "final_unit_price est null (warning)",
    });
  } else {
    checks.push({
      name: "Prix défini",
      passed: true,
      detail: `${product.final_unit_price}`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════════════════════

  return {
    productId,
    valid: errors.length === 0,
    checks,
    errors,
  };
}
