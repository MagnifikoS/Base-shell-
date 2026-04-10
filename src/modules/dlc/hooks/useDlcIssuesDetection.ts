/**
 * DLC V1 — Hook to detect DLC issues from reception line data.
 * SSOT: all DLC computation logic stays in the DLC module.
 *
 * USES CENTRALIZED THRESHOLD RESOLUTION:
 * resolveDlcWarningDays() from dlcCompute.ts (Product > Category > Establishment > Fallback)
 *
 * Responsibilities:
 * 1. Fetch product-level warning days + category_id from products_v2 (cached)
 * 2. Use establishment + category thresholds from useDlcAlertSettings
 * 3. Compute DlcLineIssue[] from user-entered DLC dates + lines
 * 4. Expose resolved warning days per product for badge rendering
 *
 * The calling module (Commandes/ReceptionDialog) only provides raw data,
 * never computes DLC status itself.
 */

import { useMemo, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeDlcStatus, resolveDlcWarningDays } from "../lib/dlcCompute";
import { useDlcAlertSettings } from "./useDlcAlertSettings";
import type { DlcLineIssue } from "../components/DlcReceptionSummaryDialog";

export interface DlcDetectionLine {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  canonical_quantity: number;
  shipped_quantity: number | null;
  unit_label_snapshot: string | null;
}

interface ProductDlcData {
  warningDays: number | null;
  categoryId: string | null;
}

interface UseDlcIssuesDetectionParams {
  /** Product IDs to fetch warning days for */
  productIds: string[];
  /** Lines from the commande */
  lines: DlcDetectionLine[];
  /** User-entered DLC dates: lineId → YYYY-MM-DD */
  dlcDates: Record<string, string>;
  /** User-entered received quantities: lineId → qty */
  receivedQtys: Record<string, number>;
}

export function useDlcIssuesDetection({
  productIds,
  lines,
  dlcDates,
  receivedQtys,
}: UseDlcIssuesDetectionParams) {
  const { defaultWarningDays, categoryThresholds } = useDlcAlertSettings();

  // 1. Fetch product-level warning days + category_id
  const [productData, setProductData] = useState<Record<string, ProductDlcData>>({});

  useEffect(() => {
    if (productIds.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("products_v2")
      .select("id, dlc_warning_days, category_id")
      .in("id", productIds)
      .then(({ data: products }: { data: { id: string; dlc_warning_days: number | null; category_id: string | null }[] | null }) => {
        if (!products) return;
        const map: Record<string, ProductDlcData> = {};
        for (const p of products) {
          map[p.id] = {
            warningDays: p.dlc_warning_days,
            categoryId: p.category_id,
          };
        }
        setProductData(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join(",")]);

  // 2. Build resolved warning days map using centralized resolution
  const productWarningDays = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const pid of productIds) {
      const info = productData[pid];
      map[pid] = resolveDlcWarningDays({
        productWarningDays: info?.warningDays,
        categoryId: info?.categoryId,
        categoryThresholds,
        establishmentDefaultDays: defaultWarningDays,
      });
    }
    return map;
  }, [productIds, productData, categoryThresholds, defaultWarningDays]);

  // 3. Compute DLC issues: lines with a DLC date that is expired or warning
  const dlcIssues: DlcLineIssue[] = useMemo(() => {
    const issues: DlcLineIssue[] = [];
    for (const line of lines) {
      const dlcDate = dlcDates[line.id];
      if (!dlcDate) continue;
      const warningDays = productWarningDays[line.product_id] ?? null;
      const status = computeDlcStatus(dlcDate, warningDays);
      if (status === "ok") continue;
      const shipped = line.shipped_quantity ?? line.canonical_quantity;
      issues.push({
        lineId: line.id,
        productName: line.product_name_snapshot,
        dlcDate,
        quantity: receivedQtys[line.id] ?? shipped,
        unitLabel: line.unit_label_snapshot,
        warningDays,
        status,
      });
    }
    return issues;
  }, [lines, dlcDates, productWarningDays, receivedQtys]);

  return {
    /** DLC issues (expired + warning only) for the summary dialog */
    dlcIssues,
    /** Per-product resolved warning days — pass to DlcBadge if needed */
    productWarningDays,
  };
}
