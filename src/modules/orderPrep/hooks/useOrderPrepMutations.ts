/**
 * useOrderPrepMutations — CRUD mutations for order prep lines
 * Upsert = insert or update on (establishment, product, supplier) for active lines.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { toast } from "sonner";
import type { OrderPrepStatus } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Upsert a single order prep line */
export function useUpsertOrderPrep() {
  const qc = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (params: {
      productId: string;
      productName: string;
      supplierId: string;
      quantity: number;
      unitId: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !estId) throw new Error("Non authentifié");

      // Check if an active line already exists for this product+supplier
      const { data: existing } = await db
        .from("to_order_lines")
        .select("id")
        .eq("establishment_id", estId)
        .eq("product_id", params.productId)
        .eq("supplier_id", params.supplierId)
        .in("status", ["pending", "checked"])
        .maybeSingle();

      if (existing) {
        // Update existing line
        const { error } = await db
          .from("to_order_lines")
          .update({
            quantity: params.quantity,
            unit_id: params.unitId,
            status: "pending",
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        // Insert new line
        const { error } = await db
          .from("to_order_lines")
          .insert({
            establishment_id: estId,
            product_id: params.productId,
            product_name: params.productName,
            supplier_id: params.supplierId,
            quantity: params.quantity,
            unit_id: params.unitId,
            status: "pending",
            created_by: user.id,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-prep-lines", estId] });
    },
    onError: () => {
      toast.error("Erreur lors de l'enregistrement");
    },
  });
}

/** Toggle line status: pending ↔ checked */
export function useToggleOrderPrepCheck() {
  const qc = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (params: { lineId: string; currentStatus: OrderPrepStatus }) => {
      const newStatus = params.currentStatus === "checked" ? "pending" : "checked";
      const { error } = await db
        .from("to_order_lines")
        .update({ status: newStatus })
        .eq("id", params.lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-prep-lines", estId] });
    },
  });
}

/** Validate all lines for a supplier (set status=validated + validated_at) */
export function useValidateSupplierPrep() {
  const qc = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (supplierId: string) => {
      const { error } = await db
        .from("to_order_lines")
        .update({ status: "validated", validated_at: new Date().toISOString() })
        .eq("establishment_id", estId)
        .eq("supplier_id", supplierId)
        .in("status", ["pending", "checked"]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-prep-lines", estId] });
      toast.success("Liste validée");
    },
    onError: () => {
      toast.error("Erreur lors de la validation");
    },
  });
}

/** Delete a single line */
export function useDeleteOrderPrepLine() {
  const qc = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useMutation({
    mutationFn: async (lineId: string) => {
      const { error } = await db
        .from("to_order_lines")
        .delete()
        .eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["order-prep-lines", estId] });
    },
  });
}
