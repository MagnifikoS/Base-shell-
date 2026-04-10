/**
 * Shared hook: compute cumulative correction deltas for a stock document.
 * Used by both BlAppDocumentDetail (to show effective quantities) and BlAppCorrectionDialog.
 *
 * Returns:
 * - deltaMap: { productId → cumulative signed delta }
 * - historyMap: { productId → { cumulative, steps[] } }
 * - newProductLines: lines added by corrections (products not in original BL)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CorrectionStep {
  correction_number: number;
  delta: number;
  running_total: number;
  posted_at: string | null;
}

export interface ProductCorrectionHistory {
  cumulative: number;
  steps: CorrectionStep[];
}

export interface CorrectionDeltaMap {
  [productId: string]: number;
}

export interface NewCorrectionLine {
  product_id: string;
  product_name: string;
  effective_quantity: number;
  canonical_unit_id: string;
  unit_label: string;
  unit_price: number | null;
}

export interface CorrectionHistoryResult {
  deltaMap: CorrectionDeltaMap;
  historyMap: Record<string, ProductCorrectionHistory>;
  /** Products added via corrections that don't exist in the original BL */
  newProductLines: NewCorrectionLine[];
}

export function useCumulativeCorrectionDeltas(
  stockDocumentId: string | null,
  blOriginalProductIds: Set<string>,
  blOriginalQuantities: Record<string, number>,
  enabled: boolean
) {
  return useQuery<CorrectionHistoryResult>({
    queryKey: ["bl-app-cumulative-deltas", stockDocumentId],
    queryFn: async () => {
      const emptyResult: CorrectionHistoryResult = {
        deltaMap: {},
        historyMap: {},
        newProductLines: [],
      };
      if (!stockDocumentId) return emptyResult;

      // 1. Fetch POSTED correction documents
      const { data: correctionDocs, error: docsErr } = await supabase
        .from("stock_documents")
        .select("id, posted_at, created_at")
        .eq("corrects_document_id", stockDocumentId)
        .eq("status", "POSTED")
        .order("created_at", { ascending: true });

      if (docsErr) throw docsErr;
      if (!correctionDocs || correctionDocs.length === 0) return emptyResult;

      // 2. Fetch all lines from those documents
      const docIds = correctionDocs.map((d) => d.id);
      const { data: lines, error: linesErr } = await supabase
        .from("stock_document_lines")
        .select("document_id, product_id, delta_quantity_canonical")
        .in("document_id", docIds);

      if (linesErr) throw linesErr;

      // 3. Group lines by document
      const linesByDoc = new Map<string, Array<{ product_id: string; delta: number }>>();
      for (const line of lines ?? []) {
        const arr = linesByDoc.get(line.document_id) ?? [];
        arr.push({ product_id: line.product_id, delta: line.delta_quantity_canonical });
        linesByDoc.set(line.document_id, arr);
      }

      // 4. Build deltaMap + historyMap
      const deltaMap: CorrectionDeltaMap = {};
      const historyMap: Record<string, ProductCorrectionHistory> = {};
      const runningTotals: Record<string, number> = {};

      for (let i = 0; i < correctionDocs.length; i++) {
        const doc = correctionDocs[i];
        const docLines = linesByDoc.get(doc.id) ?? [];

        for (const line of docLines) {
          deltaMap[line.product_id] = (deltaMap[line.product_id] ?? 0) + line.delta;

          if (runningTotals[line.product_id] === undefined) {
            runningTotals[line.product_id] = blOriginalQuantities[line.product_id] ?? 0;
          }
          runningTotals[line.product_id] =
            Math.round((runningTotals[line.product_id] + line.delta) * 10000) / 10000;

          if (!historyMap[line.product_id]) {
            historyMap[line.product_id] = { cumulative: 0, steps: [] };
          }

          historyMap[line.product_id].steps.push({
            correction_number: i + 1,
            delta: line.delta,
            running_total: runningTotals[line.product_id],
            posted_at: doc.posted_at,
          });
        }
      }

      for (const productId of Object.keys(historyMap)) {
        historyMap[productId].cumulative = deltaMap[productId] ?? 0;
      }

      // 5. Identify new products (not in original BL) and fetch their details
      const newProductIds = Object.keys(deltaMap).filter((pid) => !blOriginalProductIds.has(pid));
      let newProductLines: NewCorrectionLine[] = [];

      if (newProductIds.length > 0) {
        // Fetch product names
        const { data: products } = await supabase
          .from("products_v2")
          .select("id, nom_produit, supplier_billing_unit_id, final_unit_price")
          .in("id", newProductIds);

        // Fetch canonical_unit_id from stock_document_lines for new products
        const { data: detailedLines } = await supabase
          .from("stock_document_lines")
          .select("product_id, canonical_unit_id")
          .in("document_id", docIds)
          .in("product_id", newProductIds);

        const unitIdMap = new Map<string, string>();
        for (const dl of detailedLines ?? []) {
          if (!unitIdMap.has(dl.product_id)) {
            unitIdMap.set(dl.product_id, dl.canonical_unit_id);
          }
        }

        // Fetch unit labels
        const allUnitIds = [...new Set(unitIdMap.values())];
        let unitLabelMap = new Map<string, string>();
        if (allUnitIds.length > 0) {
          const { data: units } = await supabase
            .from("measurement_units")
            .select("id, abbreviation")
            .in("id", allUnitIds);
          unitLabelMap = new Map((units ?? []).map((u) => [u.id, u.abbreviation]));
        }

        const productMap = new Map((products ?? []).map((p) => [p.id, p]));

        newProductLines = newProductIds
          .filter((pid) => deltaMap[pid] > 0)
          .map((pid) => {
            const canonicalUnitId = unitIdMap.get(pid) ?? "";
            const prod = productMap.get(pid);
            return {
              product_id: pid,
              product_name: prod?.nom_produit ?? pid,
              effective_quantity: deltaMap[pid],
              canonical_unit_id: canonicalUnitId,
              unit_label: unitLabelMap.get(canonicalUnitId) ?? "u",
              unit_price: prod?.final_unit_price ?? null,
            };
          });
      }

      return { deltaMap, historyMap, newProductLines };
    },
    enabled: !!stockDocumentId && enabled,
  });
}
