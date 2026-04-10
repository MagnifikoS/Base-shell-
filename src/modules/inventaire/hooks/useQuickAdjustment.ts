/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useQuickAdjustment — Atomic stock correction via fn_quick_adjustment RPC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PH2-F4: Single RPC call replaces the 4-step client-side flow:
 *   OLD: snapshot check → create DRAFT → insert line → POST via edge fn
 *   NEW: fn_quick_adjustment(params) → single PG transaction
 *
 * Guarantees:
 * - Atomicity: DRAFT + line + POST in one transaction
 * - No orphan DRAFTs on failure (rollback)
 * - Idempotence: delta=0 → noop
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { computeContextHash } from "@/modules/stockLedger/engine/contextHash";
import { toast } from "sonner";

export interface QuickAdjustmentParams {
  productId: string;
  storageZoneId: string;
  estimatedQty: number;
  canonicalUnitId: string;
  canonicalFamily: string;
  canonicalLabel?: string | null;
  targetQty: number;
}

export interface QuickAdjustmentResult {
  ok: boolean;
  error?: string;
}

export function useQuickAdjustment() {
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: QuickAdjustmentParams): Promise<QuickAdjustmentResult> => {
      const estId = activeEstablishment?.id;
      const orgId = activeEstablishment?.organization_id;
      if (!user?.id || !estId || !orgId) {
        return { ok: false, error: "Non authentifié ou établissement manquant" };
      }

      const delta = params.targetQty - params.estimatedQty;
      if (delta === 0) {
        return { ok: true };
      }

      // Compute context_hash client-side (same as before)
      const contextHash = computeContextHash({
        canonical_unit_id: params.canonicalUnitId,
        billing_unit_id: null,
        packaging_levels: [],
        equivalence: null,
      });

      // Single atomic RPC call
      const { data, error } = await supabase.rpc("fn_quick_adjustment", {
        p_establishment_id: estId,
        p_organization_id: orgId,
        p_user_id: user.id,
        p_product_id: params.productId,
        p_storage_zone_id: params.storageZoneId,
        p_estimated_qty: params.estimatedQty,
        p_target_qty: params.targetQty,
        p_canonical_unit_id: params.canonicalUnitId,
        p_canonical_family: params.canonicalFamily,
        p_canonical_label: params.canonicalLabel ?? null,
        p_context_hash: contextHash,
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as Record<string, unknown> | null;
      if (!result?.ok) {
        return { ok: false, error: (result?.error as string) ?? "RPC_ERROR" };
      }

      return { ok: true };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });
      }
    },
    onError: (e: Error) => toast.error(e.message || "Erreur lors de la correction"),
  });

  return {
    adjust: mutation.mutateAsync,
    isAdjusting: mutation.isPending,
  };
}
