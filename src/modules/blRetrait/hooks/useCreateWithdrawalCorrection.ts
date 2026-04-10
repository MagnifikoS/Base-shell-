/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useCreateWithdrawalCorrection — Atomic correction via fn_correct_bl_withdrawal RPC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PH2-F6: Single RPC call replaces the multi-step client-side flow:
 *   OLD: create DRAFT → insert lines → POST via RPC → update BL lines (best-effort)
 *   NEW: fn_correct_bl_withdrawal(params) → single PG transaction
 *
 * Guarantees:
 * - Atomicity: stock correction + BL line updates in one transaction
 * - Impossible to have "stock corrected but BL not updated"
 * - If BL update fails → entire transaction rolls back (stock unchanged)
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface WithdrawalCorrectionLine {
  product_id: string;
  /** Signed delta from user perspective: negative = withdrew less, positive = withdrew more */
  user_delta: number;
  canonical_unit_id: string;
  canonical_family: string;
  canonical_label: string | null;
  context_hash: string;
}

export interface CreateWithdrawalCorrectionParams {
  originalStockDocumentId: string;
  blRetraitDocumentId: string;
  establishmentId: string;
  organizationId: string;
  storageZoneId: string;
  lines: WithdrawalCorrectionLine[];
}

export interface WithdrawalCorrectionResult {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
  events_created?: number;
}

export function useCreateWithdrawalCorrection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<WithdrawalCorrectionResult, Error, CreateWithdrawalCorrectionParams>({
    mutationFn: async (params) => {
      if (!user?.id) throw new Error("Non authentifié");

      // Build lines JSONB array for the RPC
      const linesJson = params.lines.map((l) => ({
        product_id: l.product_id,
        user_delta: l.user_delta,
        canonical_unit_id: l.canonical_unit_id,
        canonical_family: l.canonical_family,
        canonical_label: l.canonical_label,
        context_hash: l.context_hash,
      }));

      const { data, error } = await supabase.rpc("fn_correct_bl_withdrawal", {
        p_original_stock_document_id: params.originalStockDocumentId,
        p_bl_retrait_document_id: params.blRetraitDocumentId,
        p_establishment_id: params.establishmentId,
        p_organization_id: params.organizationId,
        p_storage_zone_id: params.storageZoneId,
        p_user_id: user.id,
        p_lines: linesJson,
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as Record<string, unknown> | null;
      if (!result?.ok) {
        return {
          ok: false,
          error: (result?.error as string) ?? "RPC_ERROR",
          details: result ?? undefined,
        };
      }

      return {
        ok: true,
        events_created: (result?.events_created as number) ?? 0,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents"] });
        queryClient.invalidateQueries({ queryKey: ["bl-retrait-lines"] });
        queryClient.invalidateQueries({ queryKey: ["bl-retrait-correction-deltas"] });
        queryClient.invalidateQueries({ queryKey: ["bl-withdrawal-lines"] });
        queryClient.invalidateQueries({ queryKey: ["bl-retraits"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-history"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      }
    },
  });
}
