/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useVoidDocument — Calls stock-ledger edge function to void a document
 * ═══════════════════════════════════════════════════════════════════════════
 * fn_void_stock_document is REVOKED from authenticated users (SEC-AUTH-006).
 * Must go through the stock-ledger edge function which uses service_role.
 *
 * Uses native fetch (NEVER supabase.functions.invoke with query strings).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";

export interface VoidResult {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
  void_events_created?: number;
}

export function useVoidDocument() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const voidMutation = useMutation({
    mutationFn: async (params: { documentId: string; voidReason: string }): Promise<VoidResult> => {
      if (!user?.id) throw new Error("Non authentifié");

      // STK-03: Frontend RBAC check — void requires write-level stock access
      if (!can("stock_ledger", "write")) {
        return {
          ok: false,
          error: "VOID_ACCESS_DENIED",
          details: { message: "Vous n'avez pas les droits pour annuler un document de stock." },
        };
      }

      // ── Native fetch (NEVER supabase.functions.invoke with query strings) ──
      // Bonus PH2: Use refreshSession for robustness against expired tokens
      const { data: { session } } = await supabase.auth.refreshSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const edgeFnUrl = `${supabaseUrl}/functions/v1/stock-ledger?action=void`;

      const httpRes = await fetch(edgeFnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          document_id: params.documentId,
          void_reason: params.voidReason,
        }),
      });

      let result: Record<string, unknown> | null = null;
      try {
        result = await httpRes.json();
      } catch {
        return { ok: false, error: "RPC_ERROR", details: { message: "Réponse invalide" } };
      }

      if (!httpRes.ok) {
        if (import.meta.env.DEV) {
          console.error("[useVoidDocument] edge fn error:", httpRes.status, result);
        }
        return {
          ok: false,
          error: (result?.error as string) ?? "RPC_ERROR",
          details: result ?? { message: `HTTP ${httpRes.status}` },
        };
      }

      if (result && !result.ok) {
        return {
          ok: false,
          error: (result.error as string) ?? "RPC_ERROR",
          details: result,
        };
      }

      return {
        ok: true,
        void_events_created: (result?.void_events_created as number) ?? 0,
      };
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["stock-documents-posted"] });
        queryClient.invalidateQueries({ queryKey: ["stock-documents-history"] });
        queryClient.invalidateQueries({ queryKey: ["stock-document-draft"] });
        queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
        queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-current-stock"] });
        queryClient.invalidateQueries({ queryKey: ["product-has-stock"] });
        queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      }
    },
  });

  return {
    voidDocument: voidMutation.mutateAsync,
    isVoiding: voidMutation.isPending,
  };
}
