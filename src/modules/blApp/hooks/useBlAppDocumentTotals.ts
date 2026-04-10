/**
 * Hook: compute totals for a list of BL-APP documents from SNAPSHOT prices (bl_app_lines.line_total).
 * Prices are NEVER recalculated from products_v2.final_unit_price — snapshots are the SSOT.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlAppDocument } from "../types";

export interface BlAppDocumentWithTotal extends BlAppDocument {
  total_value: number | null;
  total_display: string;
}

export function useBlAppDocumentTotals(documents: BlAppDocument[]) {
  const docIds = documents.map((d) => d.id);

  return useQuery<BlAppDocumentWithTotal[]>({
    queryKey: ["bl-app-doc-totals", docIds.join(",")],
    queryFn: async () => {
      if (docIds.length === 0) return [];

      // Fetch all lines with snapshot line_total (frozen at BL creation)
      const { data: rawLines, error: linesErr } = await supabase
        .from("bl_app_lines")
        .select("id, bl_app_document_id, line_total")
        .in("bl_app_document_id", docIds);
      if (linesErr) throw linesErr;
      const lines = rawLines ?? [];

      if (lines.length === 0) {
        return documents.map((d) => ({ ...d, total_value: null, total_display: "—" }));
      }

      // Group by document and sum snapshot totals
      const linesByDoc = new Map<string, number[]>();
      for (const line of lines) {
        const arr = linesByDoc.get(line.bl_app_document_id) ?? [];
        if (line.line_total !== null) arr.push(line.line_total);
        linesByDoc.set(line.bl_app_document_id, arr);
      }

      return documents.map((doc) => {
        const totals = linesByDoc.get(doc.id) ?? [];
        if (totals.length === 0) {
          return { ...doc, total_value: null, total_display: "—" };
        }
        const totalValue = Math.round(totals.reduce((s, v) => s + v, 0) * 100) / 100;
        return {
          ...doc,
          total_value: totalValue,
          total_display: `${totalValue.toFixed(2)} €`,
        };
      });
    },
    enabled: docIds.length > 0,
  });
}
