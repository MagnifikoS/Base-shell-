/**
 * ═══════════════════════════════════════════════════════════════════════════
 * useCreateBlRetrait — Atomic BL Retrait creation via fn_create_bl_withdrawal RPC
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PH2-F5: Single RPC call replaces the 3-step client-side flow:
 *   OLD: fn_next_bl_number → insert doc → insert lines (3 network calls)
 *   NEW: fn_create_bl_withdrawal(params) → single PG transaction
 *
 * Guarantees:
 * - Atomicity: number + doc + lines in one transaction
 * - Idempotence: if BL already exists for stock_document_id → returns existing
 * - No consumed BL numbers without valid BL document
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CreateBlRetraitPayload } from "../types/blRetrait";

interface CreateBlRetraitResult {
  id: string;
  bl_number: string;
}

export function useCreateBlRetrait() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateBlRetraitPayload): Promise<CreateBlRetraitResult> => {
      // Build lines JSONB array for the RPC
      const linesJson = payload.lines.map((line) => ({
        product_id: line.product_id,
        product_name_snapshot: line.product_name_snapshot,
        quantity: line.quantity,
        canonical_unit_id: line.canonical_unit_id || null,
        unit_price: line.unit_price ?? null,
      }));

      const { data, error } = await supabase.rpc("fn_create_bl_withdrawal", {
        p_establishment_id: payload.establishment_id,
        p_organization_id: payload.organization_id,
        p_stock_document_id: payload.stock_document_id,
        p_destination_establishment_id: payload.destination_establishment_id ?? null,
        p_destination_name: payload.destination_name ?? null,
        p_created_by: payload.created_by ?? null,
        p_lines: linesJson,
      });

      if (error) throw error;

      const result = data as Record<string, unknown> | null;
      if (!result?.ok) {
        throw new Error((result?.error as string) ?? "Failed to create BL Retrait");
      }

      return {
        id: result.id as string,
        bl_number: result.bl_number as string,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bl-retraits"] });
      queryClient.invalidateQueries({ queryKey: ["bl-withdrawal-documents"] });
      queryClient.invalidateQueries({ queryKey: ["estimated-stock"] });
      queryClient.invalidateQueries({ queryKey: ["product-current-stock"] });
      queryClient.invalidateQueries({ queryKey: ["product-has-stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-stock"] });
    },
  });
}
