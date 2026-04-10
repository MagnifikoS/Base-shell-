/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useInitializeProductStock — Prompt 1 (SSOT clean)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * For products created after the last inventory (NO_SNAPSHOT_LINE).
 * Only inserts inventory_line qty=0 to make the product "calculable".
 * NO stock_document, NO stock_event, NO target quantity.
 * Actual stock is set via "Modifier" → ADJUSTMENT (standard ledger path).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface InitializeStockResult {
  ok: boolean;
  error?: string;
  idempotent?: boolean;
  message?: string;
  snapshot_version_id?: string;
}

export function useInitializeProductStock() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (productId: string): Promise<InitializeStockResult> => {
      if (!user?.id) return { ok: false, error: "Non authentifié" };

      const { data, error } = await supabase.rpc("fn_initialize_product_stock", {
        p_product_id: productId,
        p_user_id: user.id,
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as Record<string, unknown> | null;
      if (!result?.ok) {
        return { ok: false, error: (result?.error as string) ?? "Erreur inconnue" };
      }

      return {
        ok: true,
        idempotent: (result.idempotent as boolean) ?? false,
        message: (result.message as string) ?? "Produit initialisé",
        snapshot_version_id: (result.snapshot_version_id as string) ?? undefined,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["inventory-lines"] });
        const r = result as InitializeStockResult & { unit_corrected?: boolean };
        if (r.unit_corrected) {
          toast.success("Unité corrigée — utilisez « Modifier » pour définir le stock réel.");
        } else if (result.idempotent) {
          toast.info("Produit déjà initialisé");
        } else {
          toast.success("Produit initialisé — utilisez « Modifier » pour définir le stock réel.");
        }
      }
    },
    onError: (e: Error) => toast.error(e.message || "Erreur d'initialisation"),
  });

  return {
    initialize: mutation.mutateAsync,
    isInitializing: mutation.isPending,
  };
}
