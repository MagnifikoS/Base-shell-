/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useTransferProductZone — Atomic zone transfer via fn_transfer_product_zone
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * SSOT hook for changing a product's storage zone.
 * Used by both: Wizard V3 (edit mode) and inline zone edit in inventory.
 *
 * Guarantees:
 * - Atomicity: WITHDRAWAL + RECEIPT + zone update in one PG transaction
 * - No stock loss: estimated stock is transferred, not reset to 0
 * - Idempotent: same-zone = noop
 * - Audit trail: proper stock_documents + stock_events created
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface TransferProductZoneParams {
  productId: string;
  newZoneId: string;
  /** Current estimated stock (from StockEngine). 0 = just move zone, no ledger docs. */
  estimatedQty: number;
  /** Canonical unit UUID for the stock quantity */
  canonicalUnitId: string | null;
  /** Unit family string (e.g. 'weight', 'unit') */
  canonicalFamily: string | null;
  /** BFS context hash for audit trail */
  contextHash: string | null;
}

export interface TransferProductZoneResult {
  ok: boolean;
  error?: string;
  transferred_qty?: number;
  old_zone_id?: string;
  new_zone_id?: string;
}

export function useTransferProductZone() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: TransferProductZoneParams): Promise<TransferProductZoneResult> => {
      if (!user?.id) return { ok: false, error: "Non authentifié" };

      const { data, error } = await supabase.rpc("fn_transfer_product_zone" as never, {
        p_product_id: params.productId,
        p_new_zone_id: params.newZoneId,
        p_user_id: user.id,
        p_estimated_qty: params.estimatedQty,
        p_canonical_unit_id: params.canonicalUnitId,
        p_canonical_family: params.canonicalFamily,
        p_context_hash: params.contextHash,
      } as never);

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as Record<string, unknown> | null;
      if (!result?.ok) {
        return { ok: false, error: (result?.error as string) ?? "RPC_ERROR" };
      }

      return {
        ok: true,
        transferred_qty: (result.transferred_qty as number) ?? 0,
        old_zone_id: result.old_zone_id as string | undefined,
        new_zone_id: result.new_zone_id as string | undefined,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        // Invalidate all stock-related caches
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
        queryClient.invalidateQueries({ queryKey: ["products-v2"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });

        if (result.transferred_qty && result.transferred_qty > 0) {
          toast.success(`Zone mise à jour — ${result.transferred_qty} unités transférées`);
        } else {
          toast.success("Zone de stockage mise à jour");
        }
      } else {
        // RPC returned ok=false — show error to user
        console.error("[useTransferProductZone] RPC failed:", result.error);
        toast.error(result.error || "Erreur lors du transfert de zone");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Erreur lors du transfert de zone"),
  });

  return {
    transfer: mutation.mutateAsync,
    isTransferring: mutation.isPending,
  };
}
