/**
 * useOrderPrepForProduct — Check if a product already has an active order prep line
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useOrderPrepForProduct(productId: string | null) {
  const { activeEstablishment } = useEstablishment();
  const estId = activeEstablishment?.id;

  return useQuery({
    queryKey: ["order-prep-product", estId, productId],
    enabled: !!estId && !!productId,
    queryFn: async () => {
      const { data, error } = await db
        .from("to_order_lines")
        .select("id, quantity, unit_id")
        .eq("establishment_id", estId)
        .eq("product_id", productId)
        .in("status", ["pending", "checked"])
        .maybeSingle();

      if (error) throw error;
      return data as { id: string; quantity: number; unit_id: string } | null;
    },
  });
}
