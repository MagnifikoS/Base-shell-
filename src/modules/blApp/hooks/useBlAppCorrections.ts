/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useBlAppCorrections — Fetch correction documents linked to a BL
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CorrectionDocument {
  id: string;
  status: string;
  posted_at: string | null;
  voided_at: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Fetches all RECEIPT_CORRECTION stock_documents that correct
 * the original stock_document behind a BL-APP.
 */
export function useBlAppCorrections(stockDocumentId: string | null) {
  return useQuery<CorrectionDocument[]>({
    queryKey: ["bl-app-corrections", stockDocumentId],
    queryFn: async () => {
      if (!stockDocumentId) return [];

      const { data, error } = await supabase
        .from("stock_documents")
        .select("id, status, posted_at, voided_at, created_at, created_by")
        .eq("corrects_document_id", stockDocumentId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as CorrectionDocument[];
    },
    enabled: !!stockDocumentId,
  });
}
