/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHAT — Purchase Service (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Service pour créer et lire les lignes d'achat.
 * Aucun calcul métier — lecture/écriture uniquement.
 *
 * SSOT:
 * - quantite_commandee: copie brute de items[].quantite_commandee
 * - product_id: depuis matchProductV2 ou confirmedMatches
 * - year_month: dérivé de invoice.invoice_date
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  CreatePurchaseLineInput,
  CreatePurchaseLinesResult,
  MonthlyPurchaseSummary,
  PurchaseLineItem,
} from "../types";

/**
 * Créer les lignes d'achat pour une facture validée
 * Appelé après createInvoice() succès, avant fullReset()
 */
export async function createPurchaseLines(
  lines: CreatePurchaseLineInput[]
): Promise<CreatePurchaseLinesResult> {
  if (lines.length === 0) {
    return { success: true, insertedCount: 0 };
  }

  // Vérifier que toutes les lignes ont year_month (SSOT obligatoire)
  const missingYearMonth = lines.find((l) => !l.year_month);
  if (missingYearMonth) {
    return {
      success: false,
      insertedCount: 0,
      error: "year_month manquant — impossible de créer les lignes Achat sans date facture",
    };
  }

  // Upsert idempotent: ON CONFLICT (invoice_id, source_line_id) → skip duplicate
  const { data, error } = await supabase
    .from("purchase_line_items")
    .upsert(lines, { onConflict: "invoice_id,source_line_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    if (import.meta.env.DEV)
      console.error("[purchaseService] Erreur création lignes Achat:", error);
    return {
      success: false,
      insertedCount: 0,
      error: error.message,
    };
  }

  return {
    success: true,
    insertedCount: data?.length ?? 0,
  };
}

/**
 * @deprecated Dead code — jamais appelé. Suppression prévue.
 */

/**
 * Récupérer le récap mensuel agrégé par produit
 * Jointure avec products_v2 pour obtenir le nom et l'unité SSOT
 */
export async function fetchMonthlyPurchaseSummary(
  establishmentId: string,
  yearMonth: string
): Promise<MonthlyPurchaseSummary[]> {
  // 1. Récupérer les lignes d'achat (inclut supplier_id)
  const { data: lines, error: linesError } = await supabase
    .from("purchase_line_items")
    .select(
      "product_id, quantite_commandee, line_total, invoice_id, product_name_snapshot, product_code_snapshot, unit_snapshot, supplier_id"
    )
    .eq("establishment_id", establishmentId)
    .eq("year_month", yearMonth);

  if (linesError) {
    if (import.meta.env.DEV) console.error("[purchaseService] Erreur lecture récap:", linesError);
    return [];
  }

  if (!lines || lines.length === 0) {
    return [];
  }

  // 2. Extraire les product_id uniques (non null)
  const productIds = [
    ...new Set(lines.filter((l) => l.product_id).map((l) => l.product_id)),
  ] as string[];

  // 2b. Extraire les supplier_id uniques
  const supplierIds = [...new Set(lines.map((l) => l.supplier_id))];

  // 3. Récupérer les infos produits depuis SSOT products_v2 (UUID-only)
  const productsMap: Map<
    string,
    { name: string; category: string | null; billing_unit_id: string | null }
  > = new Map();

  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products_v2")
      .select("id, nom_produit, category_id, supplier_billing_unit_id, product_categories(name)")
      .in("id", productIds);

    if (!productsError && products) {
      products.forEach((p) => {
        const categoryName = (p.product_categories as { name: string } | null)?.name ?? null;
        productsMap.set(p.id, {
          name: p.nom_produit,
          category: categoryName,
          billing_unit_id: p.supplier_billing_unit_id,
        });
      });
    }
  }

  // 3b. Récupérer les noms fournisseurs
  const suppliersMap: Map<string, string> = new Map();
  if (supplierIds.length > 0) {
    const { data: suppliers, error: suppliersError } = await supabase
      .from("invoice_suppliers")
      .select("id, name, trade_name")
      .in("id", supplierIds);

    if (!suppliersError && suppliers) {
      suppliers.forEach((s) => {
        suppliersMap.set(s.id, s.trade_name || s.name);
      });
    }
  }

  // 4. Agréger par (supplier_id, product_id/name)
  const aggregation = new Map<
    string,
    {
      productId: string | null;
      supplierId: string;
      totalQty: number | null;
      totalAmount: number | null;
      invoiceIds: Set<string>;
      snapshotName: string | null;
      snapshotCode: string | null;
      snapshotUnit: string | null;
    }
  >();

  for (const line of lines) {
    const productKey = line.product_id
      ? `id:${line.product_id}`
      : `name:${line.product_name_snapshot ?? "unknown"}`;
    const key = `${line.supplier_id}|${productKey}`;

    const existing = aggregation.get(key) || {
      productId: line.product_id,
      supplierId: line.supplier_id,
      totalQty: null,
      totalAmount: null,
      invoiceIds: new Set<string>(),
      snapshotName: line.product_name_snapshot,
      snapshotCode: line.product_code_snapshot,
      snapshotUnit: line.unit_snapshot,
    };

    if (line.quantite_commandee !== null) {
      existing.totalQty = (existing.totalQty ?? 0) + Number(line.quantite_commandee);
    }

    if (line.line_total !== null) {
      existing.totalAmount = (existing.totalAmount ?? 0) + Number(line.line_total);
    }

    existing.invoiceIds.add(line.invoice_id);

    if (!existing.snapshotName && line.product_name_snapshot) {
      existing.snapshotName = line.product_name_snapshot;
    }

    aggregation.set(key, existing);
  }

  // 4b. Batch lookup units for billing_unit labels
  const unitIds = [...new Set(
    [...productsMap.values()]
      .map((p) => p.billing_unit_id)
      .filter((id): id is string => id != null)
  )];
  const unitsMap = new Map<string, string>();
  if (unitIds.length > 0) {
    const { data: units } = await supabase
      .from("measurement_units")
      .select("id, abbreviation")
      .in("id", unitIds);
    if (units) {
      for (const u of units) unitsMap.set(u.id, u.abbreviation);
    }
  }

  // 5. Construire le résultat avec SSOT products_v2
  const result: MonthlyPurchaseSummary[] = [];

  for (const [, agg] of aggregation) {
    const productInfo = agg.productId ? productsMap.get(agg.productId) : null;

    result.push({
      product_id: agg.productId,
      product_name: productInfo?.name ?? agg.snapshotName ?? "(Produit inconnu)",
      category: productInfo?.category ?? null,
      billing_unit_id: productInfo?.billing_unit_id ?? null,
      billing_unit_label: productInfo?.billing_unit_id
        ? (unitsMap.get(productInfo.billing_unit_id) ?? null)
        : null,
      total_quantity: agg.totalQty,
      invoice_count: agg.invoiceIds.size,
      total_amount: agg.totalAmount,
      product_code_snapshot: agg.snapshotCode ?? null,
      unit_snapshot: agg.snapshotUnit ?? null,
      supplier_id: agg.supplierId,
      supplier_name: suppliersMap.get(agg.supplierId) ?? "(Fournisseur inconnu)",
    });
  }

  result.sort((a, b) => a.product_name.localeCompare(b.product_name));

  return result;
}
