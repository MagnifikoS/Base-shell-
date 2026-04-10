/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE ACHATS BRAIN SUMMARY — Service (Isolé, supprimable)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Service pour récupérer et agréger les données d'achats.
 * LECTURE SEULE — aucun insert/update/delete.
 *
 * SSOT: purchase_line_items + products_v2
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  BrainSummaryData,
  ProductMonthlyAggregate,
  ProductDelta,
  AvailableMonth,
} from "../types";
import { format, subMonths, parse } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * Récupérer les mois disponibles (6 derniers mois avec données)
 */
export async function fetchAvailableMonths(establishmentId: string): Promise<AvailableMonth[]> {
  const { data, error } = await supabase
    .from("purchase_line_items")
    .select("year_month")
    .eq("establishment_id", establishmentId)
    .order("year_month", { ascending: false });

  if (error || !data) {
    if (import.meta.env.DEV)
      console.error("[achatsBrainSummaryService] Erreur fetchAvailableMonths:", error);
    return [];
  }

  // Extraire les mois uniques
  const uniqueMonths = [...new Set(data.map((d) => d.year_month))];

  // Limiter aux 6 derniers et formater
  return uniqueMonths.slice(0, 6).map((ym) => ({
    yearMonth: ym,
    label: formatYearMonthLabel(ym),
  }));
}

/**
 * Formater YYYY-MM en "Janvier 2025"
 */
function formatYearMonthLabel(yearMonth: string): string {
  try {
    const date = parse(yearMonth, "yyyy-MM", new Date());
    return format(date, "MMMM yyyy", { locale: fr });
  } catch {
    return yearMonth;
  }
}

/**
 * Calculer le mois précédent
 */
function getPreviousYearMonth(yearMonth: string): string {
  try {
    const date = parse(yearMonth, "yyyy-MM", new Date());
    return format(subMonths(date, 1), "yyyy-MM");
  } catch {
    return "";
  }
}

/**
 * Récupérer les données agrégées pour un mois
 */
async function fetchMonthData(
  establishmentId: string,
  yearMonth: string
): Promise<{
  aggregates: ProductMonthlyAggregate[];
  supplierCount: number;
  invoiceCount: number;
}> {
  // 1. Récupérer les lignes d'achat du mois
  const { data: lines, error: linesError } = await supabase
    .from("purchase_line_items")
    .select(
      "product_id, supplier_id, invoice_id, quantite_commandee, line_total, product_name_snapshot"
    )
    .eq("establishment_id", establishmentId)
    .eq("year_month", yearMonth);

  if (linesError || !lines) {
    if (import.meta.env.DEV)
      console.error("[achatsBrainSummaryService] Erreur fetch lines:", linesError);
    return { aggregates: [], supplierCount: 0, invoiceCount: 0 };
  }

  if (lines.length === 0) {
    return { aggregates: [], supplierCount: 0, invoiceCount: 0 };
  }

  // 2. Récupérer les infos produits (batch)
  const productIds = [
    ...new Set(lines.filter((l) => l.product_id).map((l) => l.product_id)),
  ] as string[];

  const productsMap = new Map<
    string,
    { name: string; category: string | null; billing_unit: string | null }
  >();

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products_v2")
      .select("id, nom_produit, category_id, supplier_billing_unit_id, product_categories(name), measurement_units!supplier_billing_unit_id(name)")
      .in("id", productIds);

    if (products) {
      products.forEach((p) => {
        const categoryName = (p.product_categories as { name: string } | null)?.name ?? null;
        const billingUnitName = (p.measurement_units as { name: string } | null)?.name ?? null;
        productsMap.set(p.id, {
          name: p.nom_produit,
          category: categoryName,
          billing_unit: billingUnitName,
        });
      });
    }
  }

  // 3. Agréger par produit
  const aggregation = new Map<
    string | null,
    {
      totalQty: number;
      totalAmount: number;
      invoiceIds: Set<string>;
      snapshotName: string | null;
      category: string | null;
      billingUnit: string | null;
    }
  >();

  for (const line of lines) {
    const key = line.product_id;
    const existing = aggregation.get(key) || {
      totalQty: 0,
      totalAmount: 0,
      invoiceIds: new Set<string>(),
      snapshotName: line.product_name_snapshot,
      category: null,
      billingUnit: null,
    };

    if (line.quantite_commandee !== null) {
      existing.totalQty += Number(line.quantite_commandee);
    }
    if (line.line_total !== null) {
      existing.totalAmount += Number(line.line_total);
    }
    existing.invoiceIds.add(line.invoice_id);

    if (!existing.snapshotName && line.product_name_snapshot) {
      existing.snapshotName = line.product_name_snapshot;
    }

    aggregation.set(key, existing);
  }

  // 4. Construire le résultat
  const aggregates: ProductMonthlyAggregate[] = [];

  for (const [productId, agg] of aggregation) {
    const productInfo = productId ? productsMap.get(productId) : null;

    aggregates.push({
      product_id: productId,
      product_name: productInfo?.name ?? agg.snapshotName ?? "(Produit inconnu)",
      category: productInfo?.category ?? null,
      billing_unit: productInfo?.billing_unit ?? null,
      total_quantity: agg.totalQty,
      total_amount: agg.totalAmount > 0 ? agg.totalAmount : null,
      invoice_count: agg.invoiceIds.size,
    });
  }

  // Compteurs globaux
  const supplierIds = new Set(lines.map((l) => l.supplier_id));
  const invoiceIds = new Set(lines.map((l) => l.invoice_id));

  return {
    aggregates,
    supplierCount: supplierIds.size,
    invoiceCount: invoiceIds.size,
  };
}

/**
 * Récupérer le résumé complet pour l'UI
 */
export async function fetchBrainSummary(
  establishmentId: string,
  yearMonth: string
): Promise<BrainSummaryData> {
  const previousYearMonth = getPreviousYearMonth(yearMonth);

  // Fetch current and previous month in parallel
  const [currentData, previousData] = await Promise.all([
    fetchMonthData(establishmentId, yearMonth),
    previousYearMonth ? fetchMonthData(establishmentId, previousYearMonth) : Promise.resolve(null),
  ]);

  const hasPreviousMonth = previousData !== null && previousData.aggregates.length > 0;

  // Top 5 produits les plus achetés (par quantité)
  const topProducts = [...currentData.aggregates]
    .sort((a, b) => b.total_quantity - a.total_quantity)
    .slice(0, 5);

  // Calculer deltas si mois précédent disponible
  let topIncreases: ProductDelta[] = [];
  let topDecreases: ProductDelta[] = [];
  let globalDeltaPercent: number | null = null;

  if (hasPreviousMonth && previousData) {
    const previousMap = new Map<string | null, ProductMonthlyAggregate>(
      previousData.aggregates.map((p) => [p.product_id, p])
    );

    const deltas: ProductDelta[] = [];

    for (const current of currentData.aggregates) {
      const previous = previousMap.get(current.product_id);
      const prevQty = previous?.total_quantity ?? 0;
      const delta = current.total_quantity - prevQty;
      const deltaPercent =
        prevQty > 0 ? (delta / prevQty) * 100 : current.total_quantity > 0 ? 100 : 0;

      deltas.push({
        product_id: current.product_id,
        product_name: current.product_name,
        category: current.category,
        current_quantity: current.total_quantity,
        previous_quantity: prevQty,
        delta,
        delta_percent: deltaPercent,
      });
    }

    // Ajouter les produits qui ont disparu (présents avant, absents maintenant)
    for (const prev of previousData.aggregates) {
      if (!currentData.aggregates.find((c) => c.product_id === prev.product_id)) {
        deltas.push({
          product_id: prev.product_id,
          product_name: prev.product_name,
          category: prev.category,
          current_quantity: 0,
          previous_quantity: prev.total_quantity,
          delta: -prev.total_quantity,
          delta_percent: -100,
        });
      }
    }

    // Top 5 hausses (delta positif, triés par delta décroissant)
    topIncreases = deltas
      .filter((d) => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);

    // Top 5 baisses (delta négatif, triés par delta croissant)
    topDecreases = deltas
      .filter((d) => d.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);

    // Variation globale
    const currentTotal = currentData.aggregates.reduce(
      (sum, p: ProductMonthlyAggregate) => sum + p.total_quantity,
      0
    );
    const previousTotal = previousData.aggregates.reduce(
      (sum, p: ProductMonthlyAggregate) => sum + p.total_quantity,
      0
    );

    if (previousTotal > 0) {
      globalDeltaPercent = ((currentTotal - previousTotal) / previousTotal) * 100;
    }
  }

  // Catégorie dominante (par quantité totale)
  const categoryTotals = new Map<string, number>();
  for (const agg of currentData.aggregates) {
    if (agg.category) {
      const current = categoryTotals.get(agg.category) ?? 0;
      categoryTotals.set(agg.category, current + agg.total_quantity);
    }
  }

  let topCategory: string | null = null;
  let maxCategoryQty = 0;
  for (const [cat, qty] of categoryTotals) {
    if (qty > maxCategoryQty) {
      maxCategoryQty = qty;
      topCategory = cat;
    }
  }

  return {
    yearMonth,
    previousYearMonth: hasPreviousMonth ? previousYearMonth : null,
    totalDistinctProducts: currentData.aggregates.length,
    totalDistinctSuppliers: currentData.supplierCount,
    topCategory,
    totalImports: currentData.invoiceCount,
    globalDeltaPercent,
    topProducts,
    topIncreases,
    topDecreases,
    dominantCategory: topCategory,
    hasPreviousMonth,
  };
}
